use std::fs;
use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Instant;
use tauri::{Emitter, Manager};

mod phone_upload;

type SharedBakeState = Arc<Mutex<BakeProcessState>>;
type SharedExportState = Arc<Mutex<ExportProcessState>>;
type SharedPhoneUploadState = Arc<Mutex<phone_upload::PhoneUploadRuntime>>;

fn target_triple() -> &'static str {
    #[cfg(all(target_os = "windows", target_arch = "x86_64"))]
    {
        return "x86_64-pc-windows-msvc";
    }
    #[cfg(all(target_os = "windows", target_arch = "aarch64"))]
    {
        return "aarch64-pc-windows-msvc";
    }
    #[cfg(all(target_os = "macos", target_arch = "x86_64"))]
    {
        return "x86_64-apple-darwin";
    }
    #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
    {
        return "aarch64-apple-darwin";
    }
    #[cfg(all(target_os = "linux", target_arch = "x86_64"))]
    {
        return "x86_64-unknown-linux-gnu";
    }
    #[cfg(all(target_os = "linux", target_arch = "aarch64"))]
    {
        return "aarch64-unknown-linux-gnu";
    }
    #[allow(unreachable_code)]
    "unknown-target"
}

fn bundled_tool_candidates(name: &str) -> Vec<PathBuf> {
    let triple = target_triple();
    let mut candidates = Vec::new();

    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            #[cfg(windows)]
            {
                candidates.push(dir.join(format!("{name}-{triple}.exe")));
                candidates.push(dir.join(format!("{name}.exe")));
            }
            #[cfg(not(windows))]
            {
                candidates.push(dir.join(format!("{name}-{triple}")));
                candidates.push(dir.join(name));
            }
        }
    }

    let manifest_binaries = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("binaries");
    #[cfg(windows)]
    {
        candidates.push(manifest_binaries.join(format!("{name}-{triple}.exe")));
    }
    #[cfg(not(windows))]
    {
        candidates.push(manifest_binaries.join(format!("{name}-{triple}")));
    }

    candidates
}

fn resolve_tool_executable(name: &str) -> Result<PathBuf, String> {
    for path in bundled_tool_candidates(name) {
        if path.is_file() {
            return Ok(path);
        }
    }

    if let Some(path) = find_on_path(name) {
        return Ok(path);
    }

    Err(format!(
        "{name} not found. Run `npm install` (bundles FFmpeg), then restart the app."
    ))
}

fn find_on_path(name: &str) -> Option<PathBuf> {
    let path_var = std::env::var_os("PATH")?;
    #[cfg(windows)]
    let exe_name = format!("{name}.exe");
    #[cfg(not(windows))]
    let exe_name = name.to_string();

    for dir in std::env::split_paths(&path_var) {
        let candidate = dir.join(&exe_name);
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    None
}

fn tool_command(tool: &str) -> Result<Command, String> {
    let path = resolve_tool_executable(tool)?;
    Ok(Command::new(path))
}

fn run_tool_status(
    tool: &str,
    args: &[&str],
    failure_message: &str,
    idle_priority: bool,
) -> Result<(), String> {
    let mut command = tool_command(tool)?;
    configure_low_priority(&mut command, idle_priority);
    let output = command
        .args(args)
        .output()
        .map_err(|e| format!("Failed to run {tool}: {e}"))?;

    if output.status.success() {
        return Ok(());
    }

    let stderr = String::from_utf8_lossy(&output.stderr);
    let detail = stderr
        .lines()
        .rev()
        .find(|line| !line.trim().is_empty())
        .unwrap_or("unknown error");
    Err(format!("{failure_message}: {detail}"))
}

/// Write to a sidecar path so the destination folder never contains a half-written MP4.
fn temp_export_path(output_path: &str) -> String {
    format!("{output_path}.exporting.mp4")
}

fn finalize_export_file(temp_path: &str, output_path: &str) -> Result<(), String> {
    let dest = PathBuf::from(output_path);
    if dest.exists() {
        fs::remove_file(&dest).map_err(|e| e.to_string())?;
    }
    fs::rename(temp_path, &dest).map_err(|e| {
        format!("Failed to finalize export file: {e}")
    })
}

fn cleanup_temp_export(temp_path: &str) {
    let _ = fs::remove_file(temp_path);
}

struct BakeProcessState {
    child: Option<Child>,
    job_id: Option<String>,
}

impl Default for BakeProcessState {
    fn default() -> Self {
        Self {
            child: None,
            job_id: None,
        }
    }
}

struct ExportProcessState {
    cancel: Arc<AtomicBool>,
    job_id: Option<String>,
}

impl Default for ExportProcessState {
    fn default() -> Self {
        Self {
            cancel: Arc::new(AtomicBool::new(false)),
            job_id: None,
        }
    }
}

fn check_export_cancel(cancel: &AtomicBool) -> Result<(), String> {
    if cancel.load(Ordering::Relaxed) {
        Err("Export cancelled".into())
    } else {
        Ok(())
    }
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct TimelapseBakeProgressEvent {
    job_id: String,
    progress: f64,
    elapsed_ms: u64,
    status: String,
    message: Option<String>,
}

fn parse_ffmpeg_time_sec(line: &str) -> Option<f64> {
    if let Some(rest) = line.strip_prefix("out_time_ms=") {
        let micros: f64 = rest.trim().parse().ok()?;
        if micros > 0.0 {
            return Some(micros / 1_000_000.0);
        }
    }
    if let Some(rest) = line.strip_prefix("out_time_us=") {
        let micros: f64 = rest.trim().parse().ok()?;
        if micros > 0.0 {
            return Some(micros / 1_000_000.0);
        }
    }

    let key = "time=";
    let pos = line.find(key)?;
    let rest = line[pos + key.len()..].trim_start();
    let time_part = rest.split_whitespace().next()?;
    let parts: Vec<&str> = time_part.split(':').collect();
    if parts.len() != 3 {
        return None;
    }
    let hours: f64 = parts[0].parse().ok()?;
    let minutes: f64 = parts[1].parse().ok()?;
    let seconds: f64 = parts[2].parse().ok()?;
    Some(hours * 3600.0 + minutes * 60.0 + seconds)
}

fn is_unit_speed(speed: f64) -> bool {
    (speed - 1.0).abs() < 0.01
}

fn part_output_duration(part: &TimelinePart) -> f64 {
    (part.end - part.start) / part.speed
}

fn concat_list_path(path: &str) -> String {
    path.replace('\\', "/")
}

fn emit_bake_progress(
    app: &tauri::AppHandle,
    job_id: &str,
    progress: f64,
    elapsed_ms: u64,
    status: &str,
    message: Option<&str>,
) {
    let _ = app.emit(
        "timelapse-bake-progress",
        TimelapseBakeProgressEvent {
            job_id: job_id.to_string(),
            progress,
            elapsed_ms,
            status: status.to_string(),
            message: message.map(str::to_string),
        },
    );
}

/// Leave CPU headroom for preview bake — modest thread cap.
fn ffmpeg_thread_limit() -> String {
    let cores = std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(4);
    let threads = (cores / 2).max(1).min(4);
    threads.to_string()
}

/// Export uses most cores — below-normal priority keeps the UI responsive.
fn ffmpeg_thread_limit_export() -> String {
    let cores = std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(4);
    let threads = cores.saturating_sub(1).max(2).min(8);
    threads.to_string()
}

fn configure_low_priority(command: &mut Command, idle: bool) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const BELOW_NORMAL_PRIORITY_CLASS: u32 = 0x0000_4000;
        const IDLE_PRIORITY_CLASS: u32 = 0x0000_0040;
        command.creation_flags(if idle {
            IDLE_PRIORITY_CLASS
        } else {
            BELOW_NORMAL_PRIORITY_CLASS
        });
    }
}

fn cancel_active_bake(
    app: &tauri::AppHandle,
    bake_state: &SharedBakeState,
    reason: &str,
) -> Result<(), String> {
    let mut state = bake_state.lock().map_err(|e| e.to_string())?;
    if let Some(job_id) = state.job_id.take() {
        emit_bake_progress(app, &job_id, 0.0, 0, "cancelled", Some(reason));
    }
    if let Some(mut child) = state.child.take() {
        let _ = child.kill();
        let _ = child.wait();
    }
    Ok(())
}

fn run_ffmpeg_simple(args: &[&str], failure_message: &str, idle_priority: bool) -> Result<(), String> {
    let mut command = tool_command("ffmpeg")?;
    configure_low_priority(&mut command, idle_priority);
    let output = command
        .args(args)
        .output()
        .map_err(|e| format!("Failed to run ffmpeg: {e}"))?;
    if output.status.success() {
        return Ok(());
    }
    let stderr = String::from_utf8_lossy(&output.stderr);
    let detail = stderr
        .lines()
        .rev()
        .find(|line| !line.trim().is_empty())
        .unwrap_or("unknown error");
    Err(format!("{failure_message}: {detail}"))
}

/// Encode one timelapse segment with live export progress (stderr time= parsing).
fn run_ffmpeg_export_encode(
    app: &tauri::AppHandle,
    job_id: &str,
    cancel: &AtomicBool,
    args: &[&str],
    failure_message: &str,
    part_out_duration: f64,
    completed_out: f64,
    total_out_duration: f64,
    export_start: Instant,
    status_message: &str,
    progress_start: f64,
    progress_span: f64,
) -> Result<(), String> {
    check_export_cancel(cancel)?;

    let mut command = tool_command("ffmpeg")?;
    configure_low_priority(&mut command, false);
    let mut child = command
        .args(args)
        .stderr(Stdio::piped())
        .stdout(Stdio::null())
        .spawn()
        .map_err(|e| format!("Failed to run ffmpeg: {e}"))?;

    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "Failed to capture ffmpeg stderr".to_string())?;

    let app_stderr = app.clone();
    let job_stderr = job_id.to_string();
    let msg = status_message.to_string();
    let stderr_thread = std::thread::spawn(move || {
        let reader = BufReader::new(stderr);
        let mut last_emit = Instant::now();
        for line in reader.lines().map_while(Result::ok) {
            if let Some(current_time) = parse_ffmpeg_time_sec(&line) {
                if last_emit.elapsed().as_millis() >= 250 {
                    let part_frac = if part_out_duration > 0.0 {
                        (current_time / part_out_duration).clamp(0.0, 1.0)
                    } else {
                        0.0
                    };
                    let pct = if total_out_duration > 0.0 {
                        (progress_start
                            + (completed_out + part_frac * part_out_duration) / total_out_duration
                                * progress_span)
                            .clamp(progress_start, progress_start + progress_span - 0.5)
                    } else {
                        progress_start
                    };
                    emit_export_progress(
                        &app_stderr,
                        &job_stderr,
                        pct,
                        export_start.elapsed().as_millis() as u64,
                        "running",
                        Some(&msg),
                    );
                    last_emit = Instant::now();
                }
            }
        }
    });

    let status = child
        .wait()
        .map_err(|e| format!("Failed waiting for ffmpeg: {e}"))?;
    let _ = stderr_thread.join();
    check_export_cancel(cancel)?;

    if status.success() {
        return Ok(());
    }

    Err(format!(
        "{failure_message}: ffmpeg exited with code {:?}",
        status.code()
    ))
}

fn read_progress_file(path: &PathBuf) -> Option<f64> {
    let content = fs::read_to_string(path).ok()?;
    let mut best: f64 = 0.0;
    for line in content.lines() {
        if let Some(t) = parse_ffmpeg_time_sec(line) {
            best = best.max(t);
        }
    }
    if best > 0.0 { Some(best) } else { None }
}

fn run_ffmpeg_with_progress(
    app: &tauri::AppHandle,
    bake_state: &SharedBakeState,
    job_id: &str,
    args: &[&str],
    output_duration: f64,
    failure_message: &str,
    idle_priority: bool,
    cancel_previous: bool,
) -> Result<(), String> {
    if cancel_previous {
        cancel_active_bake(app, bake_state, "Superseded by a newer bake")?;
    }

    let progress_file = args
        .iter()
        .position(|arg| *arg == "-progress")
        .and_then(|idx| args.get(idx + 1))
        .map(PathBuf::from);

    let mut command = tool_command("ffmpeg")?;
    configure_low_priority(&mut command, idle_priority);
    let mut child = command
        .args(args)
        .stderr(Stdio::piped())
        .stdout(Stdio::null())
        .spawn()
        .map_err(|e| format!("Failed to run ffmpeg: {e}"))?;

    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "Failed to capture ffmpeg stderr".to_string())?;

    {
        let mut state = bake_state.lock().map_err(|e| e.to_string())?;
        state.child = Some(child);
        state.job_id = Some(job_id.to_string());
    }

    let start = Instant::now();
    let app_for_thread = app.clone();
    let job_id_for_thread = job_id.to_string();
    let progress_path = progress_file.clone();
    let finished = Arc::new(AtomicBool::new(false));
    let finished_for_stderr = Arc::clone(&finished);
    let finished_for_wait = Arc::clone(&finished);
    let app_for_stderr = app_for_thread.clone();
    let job_for_stderr = job_id_for_thread.clone();

    std::thread::spawn(move || {
        let reader = BufReader::new(stderr);
        for line in reader.lines().map_while(Result::ok) {
            if let Some(current_time) = parse_ffmpeg_time_sec(&line) {
                let progress = if output_duration > 0.0 {
                    (current_time / output_duration * 100.0).clamp(0.0, 99.0)
                } else {
                    0.0
                };
                emit_bake_progress(
                    &app_for_stderr,
                    &job_for_stderr,
                    progress,
                    start.elapsed().as_millis() as u64,
                    "running",
                    None,
                );
            }
        }
        finished_for_stderr.store(true, Ordering::Relaxed);
    });

    let progress_thread = std::thread::spawn(move || {
        let mut last_emit = Instant::now();
        while !finished.load(Ordering::Relaxed) {
            if let Some(path) = &progress_path {
                if let Some(current_time) = read_progress_file(path) {
                    if last_emit.elapsed().as_millis() >= 200 {
                        let progress = if output_duration > 0.0 {
                            (current_time / output_duration * 100.0).clamp(0.0, 99.0)
                        } else {
                            0.0
                        };
                        emit_bake_progress(
                            &app_for_thread,
                            &job_id_for_thread,
                            progress,
                            start.elapsed().as_millis() as u64,
                            "running",
                            None,
                        );
                        last_emit = Instant::now();
                    }
                }
            }
            std::thread::sleep(std::time::Duration::from_millis(200));
        }
    });

    let status = {
        let mut state = bake_state.lock().map_err(|e| e.to_string())?;
        if let Some(mut child) = state.child.take() {
            state.job_id = None;
            child
                .wait()
                .map_err(|e| format!("Failed waiting for ffmpeg: {e}"))
        } else {
            return Err("FFmpeg process lost".into());
        }
    }?;

    finished_for_wait.store(true, Ordering::Relaxed);
    let _ = progress_thread.join();

    if status.success() {
        emit_bake_progress(
            app,
            job_id,
            100.0,
            start.elapsed().as_millis() as u64,
            "completed",
            None,
        );
        return Ok(());
    }

    let code = status.code().unwrap_or(-1);
    emit_bake_progress(
        app,
        job_id,
        0.0,
        start.elapsed().as_millis() as u64,
        "failed",
        Some(&format!("exit code {code}")),
    );
    Err(format!("{failure_message} (exit code {code})"))
}

#[derive(Clone, serde::Deserialize)]
struct TimelapseSegmentInput {
    start_time: f64,
    end_time: f64,
    speed_factor: f64,
}

#[derive(Clone, serde::Deserialize)]
struct OverlayClipInput {
    file_path: String,
    start_time: f64,
    duration: f64,
    track: String,
    is_image: bool,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct TimelapseBakeResult {
    job_id: String,
    output_path: String,
    duration: f64,
    async_started: bool,
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct TimelapseBakeCompleteEvent {
    job_id: String,
    output_path: String,
    duration: f64,
    status: String,
    message: Option<String>,
}

fn emit_bake_complete(
    app: &tauri::AppHandle,
    job_id: &str,
    output_path: &str,
    duration: f64,
    status: &str,
    message: Option<&str>,
) {
    let _ = app.emit(
        "timelapse-bake-complete",
        TimelapseBakeCompleteEvent {
            job_id: job_id.to_string(),
            output_path: output_path.to_string(),
            duration,
            status: status.to_string(),
            message: message.map(str::to_string),
        },
    );
}

fn resolve_source_length(input_path: &str, source_duration: Option<f64>) -> Result<f64, String> {
    if let Some(duration) = source_duration {
        if duration.is_finite() && duration > 0.0 {
            return Ok(duration);
        }
    }
    resolve_video_duration(input_path, source_duration)
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct ExportMp4Result {
    output_path: String,
    duration: f64,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct ExportStartResult {
    job_id: String,
    output_path: String,
    async_started: bool,
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct ExportProgressEvent {
    job_id: String,
    progress: f64,
    elapsed_ms: u64,
    status: String,
    message: Option<String>,
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct ExportCompleteEvent {
    job_id: String,
    output_path: String,
    duration: f64,
    status: String,
    message: Option<String>,
}

fn emit_export_progress(
    app: &tauri::AppHandle,
    job_id: &str,
    progress: f64,
    elapsed_ms: u64,
    status: &str,
    message: Option<&str>,
) {
    let _ = app.emit(
        "export-progress",
        ExportProgressEvent {
            job_id: job_id.to_string(),
            progress,
            elapsed_ms,
            status: status.to_string(),
            message: message.map(str::to_string),
        },
    );
}

fn emit_export_complete(
    app: &tauri::AppHandle,
    job_id: &str,
    output_path: &str,
    duration: f64,
    status: &str,
    message: Option<&str>,
) {
    let _ = app.emit(
        "export-complete",
        ExportCompleteEvent {
            job_id: job_id.to_string(),
            output_path: output_path.to_string(),
            duration,
            status: status.to_string(),
            message: message.map(str::to_string),
        },
    );
}

struct ExportEncodeProfile {
    preset: &'static str,
    crf: &'static str,
}

#[derive(Clone, serde::Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct ExportSettingsInput {
    #[serde(default = "default_export_quality")]
    quality_preset: String,
    #[serde(default = "default_export_resolution")]
    resolution: String,
}

fn default_export_quality() -> String {
    "fast".into()
}

fn default_export_resolution() -> String {
    "original".into()
}

fn export_encode_profile(preset: &str) -> ExportEncodeProfile {
    match preset {
        "high" => ExportEncodeProfile {
            preset: "slow",
            crf: "18",
        },
        "youtube" => ExportEncodeProfile {
            preset: "medium",
            crf: "20",
        },
        _ => ExportEncodeProfile {
            preset: "ultrafast",
            crf: "23",
        },
    }
}

fn resolution_scale_filter(resolution: &str) -> Option<&'static str> {
    match resolution {
        "1080p" => Some(
            "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2",
        ),
        "4k" => Some(
            "scale=3840:2160:force_original_aspect_ratio=decrease,pad=3840:2160:(ow-iw)/2:(oh-ih)/2",
        ),
        _ => None,
    }
}

fn needs_video_reencode(settings: &ExportSettingsInput) -> bool {
    settings.resolution != "original"
}

fn append_final_video_output(filter: &mut String, video_label: &str, settings: &ExportSettingsInput) {
    if let Some(scale) = resolution_scale_filter(&settings.resolution) {
        filter.push_str(&format!("[{video_label}]{scale},format=yuv420p[outv];"));
    } else {
        filter.push_str(&format!("[{video_label}]format=yuv420p[outv];"));
    }
}

#[derive(Clone)]
struct TimelinePart {
    start: f64,
    end: f64,
    speed: f64,
}

#[tauri::command]
fn read_text_file(path: String) -> Result<String, String> {
    fs::read_to_string(&path).map_err(|e| e.to_string())
}

#[tauri::command]
fn write_text_file(path: String, content: String) -> Result<(), String> {
    if let Some(parent) = PathBuf::from(&path).parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(&path, content).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_app_data_dir(app: tauri::AppHandle) -> Result<String, String> {
    app.path()
        .app_data_dir()
        .map(|p| p.to_string_lossy().into_owned())
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn open_path_in_explorer(path: String) -> Result<(), String> {
    let path_buf = PathBuf::from(&path);
    let target = if path_buf.is_file() {
        path_buf
            .parent()
            .map(|p| p.to_path_buf())
            .unwrap_or(path_buf)
    } else {
        path_buf
    };

    if !target.exists() {
        return Err(format!("Path not found: {}", target.to_string_lossy()));
    }

    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(target.as_os_str())
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(target.as_os_str())
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(target.as_os_str())
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    Ok(())
}

fn parse_ffmpeg_duration(stderr: &str) -> Option<f64> {
    for line in stderr.lines() {
        if let Some(rest) = line.strip_prefix("Duration:") {
            let time = rest.trim().split(',').next()?.trim();
            let parts: Vec<&str> = time.split(':').collect();
            if parts.len() != 3 {
                continue;
            }
            let hours: f64 = parts[0].parse().ok()?;
            let minutes: f64 = parts[1].parse().ok()?;
            let seconds: f64 = parts[2].parse().ok()?;
            let total = hours * 3600.0 + minutes * 60.0 + seconds;
            if total > 0.0 {
                return Some(total);
            }
        }
    }
    None
}

fn parse_positive_duration(text: &str) -> Option<f64> {
    let trimmed = text.trim();
    if trimmed.is_empty() || trimmed.eq_ignore_ascii_case("n/a") {
        return None;
    }
    let value: f64 = trimmed.parse().ok()?;
    if value.is_finite() && value > 0.0 {
        Some(value)
    } else {
        None
    }
}

fn duration_from_ffprobe_format(path: &str) -> Option<f64> {
    let output = tool_command("ffprobe").ok()?
        .args([
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "default=noprint_wrappers=1:nokey=1",
            path,
        ])
        .output()
        .ok()?;

    parse_positive_duration(&String::from_utf8_lossy(&output.stdout))
}

fn duration_from_ffprobe_stream(path: &str) -> Option<f64> {
    let output = tool_command("ffprobe").ok()?
        .args([
            "-v",
            "error",
            "-select_streams",
            "v:0",
            "-show_entries",
            "stream=duration",
            "-of",
            "default=noprint_wrappers=1:nokey=1",
            path,
        ])
        .output()
        .ok()?;

    parse_positive_duration(&String::from_utf8_lossy(&output.stdout))
}

fn duration_from_ffmpeg(path: &str) -> Option<f64> {
    let output = tool_command("ffmpeg").ok()?
        .args(["-i", path])
        .output()
        .ok()?;

    parse_ffmpeg_duration(&String::from_utf8_lossy(&output.stderr))
}

fn resolve_video_duration(path: &str, fallback: Option<f64>) -> Result<f64, String> {
    let path_buf = PathBuf::from(path);
    if !path_buf.exists() {
        return Err(format!("Video file not found: {path}"));
    }

    let canonical = path_buf
        .canonicalize()
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_else(|_| path.to_string());

    let probed = duration_from_ffprobe_format(&canonical)
        .or_else(|| duration_from_ffprobe_stream(&canonical))
        .or_else(|| duration_from_ffprobe_format(path))
        .or_else(|| duration_from_ffprobe_stream(path))
        .or_else(|| duration_from_ffmpeg(&canonical))
        .or_else(|| duration_from_ffmpeg(path));

    if let Some(duration) = probed {
        return Ok(duration);
    }

    if let Some(fallback) = fallback {
        if fallback.is_finite() && fallback > 0.0 {
            return Ok(fallback);
        }
    }

    Err(
        "Could not read video duration — ensure ffmpeg/ffprobe is on PATH, or reload the video"
            .into(),
    )
}

#[tauri::command]
fn get_video_duration(path: String) -> f64 {
    if path.is_empty() {
        return 0.0;
    }

    resolve_video_duration(&path, None).unwrap_or(0.0)
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct ImportMainVideoResult {
    file_path: String,
    duration: f64,
    /// True when H.264/AAC was remuxed without re-encoding.
    remuxed: bool,
    /// True when the file was transcoded (e.g. iPhone HEVC → H.264).
    transcoded: bool,
}

fn validate_main_video_source(source_path: &str) -> Result<(), String> {
    if source_path.is_empty() {
        return Err("No video selected".into());
    }
    let source = PathBuf::from(source_path);
    if !source.exists() {
        return Err(format!("Video file not found: {source_path}"));
    }
    let ext = path_extension_lower(source_path);
    const ALLOWED: &[&str] = &[
        "mp4", "mov", "m4v", "mkv", "webm", "avi", "3gp", "3g2", "mts", "m2ts", "ts", "mpg",
        "mpeg",
    ];
    if !ALLOWED.contains(&ext.as_str()) {
        return Err(format!(
            "Unsupported video type (.{ext}). Try MP4 or MOV from your phone."
        ));
    }
    Ok(())
}

fn path_extension_lower(path: &str) -> String {
    PathBuf::from(path)
        .extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.to_lowercase())
        .unwrap_or_default()
}

/// Use the uploaded/selected video file directly — no re-encode on import.
#[tauri::command]
fn import_main_video(source_path: String) -> Result<ImportMainVideoResult, String> {
    validate_main_video_source(&source_path)?;
    let duration = resolve_video_duration(&source_path, None).unwrap_or(0.0);
    Ok(ImportMainVideoResult {
        file_path: source_path,
        duration,
        remuxed: false,
        transcoded: false,
    })
}

const PHONE_STITCH_CROSSFADE_SECS: f64 = 0.7;
const PHONE_STITCH_SCALE_FILTER: &str = "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30,format=yuv420p";

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct StitchPhoneClipsResult {
    file_path: String,
    duration: f64,
}

fn sanitize_stitch_project_name(name: &str) -> String {
    let mut out = String::new();
    for c in name.chars() {
        if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
            out.push(c);
        } else if c.is_whitespace() {
            out.push('_');
        }
    }
    let trimmed = out.trim_matches('_');
    if trimmed.is_empty() {
        "phone_project".to_string()
    } else {
        trimmed.chars().take(48).collect()
    }
}

fn normalize_phone_clip_for_stitch(input_path: &str, output_path: &str) -> Result<(), String> {
    let vf = PHONE_STITCH_SCALE_FILTER;
    let with_audio = run_ffmpeg_simple(
        &[
            "-y",
            "-hide_banner",
            "-nostdin",
            "-i",
            input_path,
            "-vf",
            vf,
            "-c:v",
            "libx264",
            "-preset",
            "fast",
            "-crf",
            "23",
            "-pix_fmt",
            "yuv420p",
            "-c:a",
            "aac",
            "-b:a",
            "128k",
            "-ar",
            "48000",
            "-ac",
            "2",
            "-shortest",
            output_path,
        ],
        "Failed to normalize clip for stitching",
        false,
    );
    if with_audio.is_ok() {
        return Ok(());
    }

    run_ffmpeg_simple(
        &[
            "-y",
            "-hide_banner",
            "-nostdin",
            "-i",
            input_path,
            "-f",
            "lavfi",
            "-i",
            "anullsrc=channel_layout=stereo:sample_rate=48000",
            "-map",
            "0:v:0",
            "-map",
            "1:a:0",
            "-vf",
            vf,
            "-c:v",
            "libx264",
            "-preset",
            "fast",
            "-crf",
            "23",
            "-pix_fmt",
            "yuv420p",
            "-c:a",
            "aac",
            "-b:a",
            "128k",
            "-shortest",
            output_path,
        ],
        "Failed to normalize clip for stitching (silent audio fallback)",
        false,
    )
}

fn build_phone_stitch_filter(durations: &[f64], crossfade: f64) -> String {
    let count = durations.len();
    if count < 2 {
        return String::new();
    }

    if crossfade <= 0.001 {
        let mut filter = String::new();
        for index in 0..count {
            filter.push_str(&format!("[{index}:v][{index}:a]"));
        }
        filter.push_str(&format!("concat=n={count}:v=1:a=1[vout][aout];"));
        return filter;
    }

    let mut filter = String::new();
    let mut video_prev = "0:v".to_string();
    let mut audio_prev = "0:a".to_string();

    for index in 1..count {
        let offset: f64 = durations[..index].iter().sum::<f64>() - index as f64 * crossfade;
        let video_out = if index == count - 1 {
            "vout".to_string()
        } else {
            format!("v{index}")
        };
        let audio_out = if index == count - 1 {
            "aout".to_string()
        } else {
            format!("a{index}")
        };

        filter.push_str(&format!(
            "[{video_prev}][{index}:v]xfade=transition=fade:duration={crossfade:.3}:offset={offset:.3}[{video_out}];"
        ));
        filter.push_str(&format!(
            "[{audio_prev}][{index}:a]acrossfade=d={crossfade:.3}:c1=tri:c2=tri[{audio_out}];"
        ));

        video_prev = video_out;
        audio_prev = audio_out;
    }

    filter
}

fn phone_stitch_crossfade_for_durations(durations: &[f64]) -> f64 {
    let min_duration = durations
        .iter()
        .copied()
        .fold(f64::INFINITY, f64::min);
    if !min_duration.is_finite() || min_duration <= 0.5 {
        return 0.0;
    }
    if min_duration <= PHONE_STITCH_CROSSFADE_SECS {
        return 0.0;
    }
    PHONE_STITCH_CROSSFADE_SECS.min(min_duration / 3.0)
}

fn run_phone_stitch_ffmpeg(
    normalized_paths: &[String],
    durations: &[f64],
    crossfade: f64,
    output_path: &str,
) -> Result<(), String> {
    let filter = build_phone_stitch_filter(durations, crossfade);
    let mut args = vec!["-y", "-hide_banner", "-nostdin"];
    for path in normalized_paths {
        args.push("-i");
        args.push(path.as_str());
    }
    args.extend([
        "-filter_complex",
        &filter,
        "-map",
        "[vout]",
        "-map",
        "[aout]",
        "-c:v",
        "libx264",
        "-preset",
        "fast",
        "-crf",
        "23",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-b:a",
        "192k",
        "-movflags",
        "+faststart",
        output_path,
    ]);
    run_ffmpeg_simple(&args, "Failed to stitch phone clips", false)
}

/// Stitch phone-uploaded clips in order with smooth crossfades between each pair.
#[tauri::command]
fn stitch_phone_clips(
    app: tauri::AppHandle,
    source_paths: Vec<String>,
    project_name: String,
) -> Result<StitchPhoneClipsResult, String> {
    if source_paths.is_empty() {
        return Err("No clips to stitch".into());
    }

    for path in &source_paths {
        validate_main_video_source(path)?;
    }

    if source_paths.len() == 1 {
        let path = source_paths[0].clone();
        let duration = resolve_video_duration(&path, None).unwrap_or(0.0);
        return Ok(StitchPhoneClipsResult {
            file_path: path,
            duration,
        });
    }

    let work_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("phone_stitch")
        .join(format!(
            "{}_{}",
            sanitize_stitch_project_name(&project_name),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_millis())
                .unwrap_or(0)
        ));
    if work_dir.exists() {
        let _ = fs::remove_dir_all(&work_dir);
    }
    fs::create_dir_all(&work_dir).map_err(|e| e.to_string())?;

    let mut normalized_paths = Vec::new();
    let mut durations = Vec::new();

    for (index, source_path) in source_paths.iter().enumerate() {
        let normalized = work_dir.join(format!("norm_{index:03}.mp4"));
        let normalized_str = normalized.to_string_lossy().into_owned();
        normalize_phone_clip_for_stitch(source_path, &normalized_str)?;
        let duration = resolve_video_duration(&normalized_str, None).unwrap_or(0.0);
        if duration <= 0.1 {
            return Err(format!("Clip {} has no usable duration", index + 1));
        }
        normalized_paths.push(normalized_str);
        durations.push(duration);
    }

    let crossfade = phone_stitch_crossfade_for_durations(&durations);
    let output_path = work_dir
        .join("stitched.mp4")
        .to_string_lossy()
        .into_owned();

    if let Err(primary_err) =
        run_phone_stitch_ffmpeg(&normalized_paths, &durations, crossfade, &output_path)
    {
        let hard_cut_err = run_phone_stitch_ffmpeg(
            &normalized_paths,
            &durations,
            0.0,
            &output_path,
        )
        .map_err(|fallback_err| {
            format!("{primary_err} (hard-cut fallback also failed: {fallback_err})")
        })?;
        let _ = hard_cut_err;
    }

    let duration = resolve_video_duration(&output_path, None).unwrap_or_else(|_| {
        let overlap = phone_stitch_crossfade_for_durations(&durations)
            * (durations.len().saturating_sub(1) as f64);
        durations.iter().sum::<f64>() - overlap
    });

    Ok(StitchPhoneClipsResult {
        file_path: output_path,
        duration,
    })
}

const HOOK_TARGET_TOTAL_SECS: f64 = 20.0;
const HOOK_MIN_TOTAL_SECS: f64 = 15.0;
const HOOK_MAX_TOTAL_SECS: f64 = 25.0;
const HOOK_SEGMENT_MIN_SECS: f64 = 3.0;
const HOOK_SEGMENT_MAX_SECS: f64 = 7.0;
const HOOK_CLIP_COUNT: usize = 4;
const HOOK_CROSSFADE_SECS: f64 = 0.5;
const HOOK_MONTAGE_NAME: &str = "Hook Preview";

#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
enum HookRole {
    Teaser = 0,
    Setup = 1,
    Insight = 2,
    Payoff = 3,
}

#[derive(Clone)]
struct TimeRange {
    start: f64,
    end: f64,
}

impl TimeRange {
    fn duration(&self) -> f64 {
        (self.end - self.start).max(0.0)
    }

    fn overlap_secs(&self, start: f64, end: f64) -> f64 {
        let overlap_start = self.start.max(start);
        let overlap_end = self.end.min(end);
        (overlap_end - overlap_start).max(0.0)
    }
}

#[derive(Clone)]
struct PlannedHookSegment {
    start: f64,
    end: f64,
    role: HookRole,
    speech_ratio: f64,
    motion_score: f64,
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct HookClipResult {
    file_path: String,
    duration: f64,
    friendly_name: String,
}

fn parse_showinfo_pts_time(line: &str) -> Option<f64> {
    let key = "pts_time:";
    let pos = line.find(key)?;
    let rest = line[pos + key.len()..].trim_start();
    let token = rest.split_whitespace().next()?;
    let value: f64 = token.parse().ok()?;
    if value.is_finite() && value >= 0.0 {
        Some(value)
    } else {
        None
    }
}

/// Fast scene sampling — skips full decode on long videos; subsamples shorter ones.
fn detect_scene_timestamps(path: &str, duration: f64) -> Result<Vec<f64>, String> {
    // Long-form: heuristic planning only (no decode).
    if duration > 600.0 {
        return Ok(Vec::new());
    }

    let analyze_secs = (duration * 0.4).clamp(45.0, 180.0).min(duration);
    let mut command = tool_command("ffmpeg")?;
    configure_low_priority(&mut command, true);
    let t_arg = format!("{analyze_secs:.2}");
    let output = command
        .args([
            "-hide_banner",
            "-nostdin",
            "-t",
            &t_arg,
            "-i",
            path,
            "-an",
            "-vf",
            "fps=1,scale=480:-1,select='gt(scene,0.36)',showinfo",
            "-vsync",
            "vfr",
            "-f",
            "null",
            "-",
        ])
        .output()
        .map_err(|e| format!("Scene analysis failed: {e}"))?;

    let mut times = Vec::new();
    for line in String::from_utf8_lossy(&output.stderr).lines() {
        if let Some(t) = parse_showinfo_pts_time(line) {
            times.push(t);
        }
    }

    times.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    times.dedup_by(|a, b| (*a - *b).abs() < 0.45);
    Ok(times)
}

/// Audio-only pass — fast even on 20–30 minute videos.
fn detect_speech_regions(path: &str, duration: f64) -> Result<Vec<TimeRange>, String> {
    let mut command = tool_command("ffmpeg")?;
    configure_low_priority(&mut command, true);
    let output = command
        .args([
            "-hide_banner",
            "-nostdin",
            "-i",
            path,
            "-vn",
            "-af",
            "silencedetect=noise=-32dB:d=0.35",
            "-f",
            "null",
            "-",
        ])
        .output()
        .map_err(|e| format!("Speech analysis failed: {e}"))?;

    let mut silence_ranges = Vec::new();
    let mut silence_start: Option<f64> = None;

    for line in String::from_utf8_lossy(&output.stderr).lines() {
        if let Some(pos) = line.find("silence_start:") {
            let token = line[pos + "silence_start:".len()..]
                .trim()
                .split_whitespace()
                .next()
                .unwrap_or("");
            if let Ok(value) = token.parse::<f64>() {
                if value.is_finite() {
                    silence_start = Some(value.max(0.0));
                }
            }
        }
        if let Some(pos) = line.find("silence_end:") {
            let token = line[pos + "silence_end:".len()..]
                .trim()
                .split_whitespace()
                .next()
                .unwrap_or("");
            if let Ok(end) = token.parse::<f64>() {
                if end.is_finite() {
                    if let Some(start) = silence_start.take() {
                        if end > start + 0.05 {
                            silence_ranges.push(TimeRange { start, end });
                        }
                    }
                }
            }
        }
    }

    let mut speech = Vec::new();
    let mut cursor = 0.0;
    for silence in silence_ranges {
        if silence.start > cursor + 0.25 {
            speech.push(TimeRange {
                start: cursor,
                end: silence.start,
            });
        }
        cursor = silence.end.max(cursor);
    }
    if cursor < duration - 0.25 {
        speech.push(TimeRange {
            start: cursor,
            end: duration,
        });
    }

    Ok(speech)
}

fn speech_ratio_in_window(speech: &[TimeRange], start: f64, end: f64) -> f64 {
    let window_len = (end - start).max(0.001);
    let covered: f64 = speech
        .iter()
        .map(|region| region.overlap_secs(start, end))
        .sum();
    (covered / window_len).clamp(0.0, 1.0)
}

fn motion_score_in_window(scene_times: &[f64], start: f64, end: f64) -> f64 {
    let count = scene_times
        .iter()
        .filter(|t| **t >= start && **t <= end)
        .count();
    (count as f64 / 3.0).min(1.0)
}

fn build_hook_candidate_centers(
    duration: f64,
    scene_times: &[f64],
    speech: &[TimeRange],
) -> Vec<f64> {
    let margin_start = duration * 0.04;
    let margin_end = duration * 0.96;
    let mut candidates: Vec<f64> = scene_times
        .iter()
        .copied()
        .filter(|t| *t >= margin_start && *t <= margin_end)
        .collect();

    for region in speech {
        if region.duration() >= 1.2 {
            let mid = (region.start + region.end) * 0.5;
            if mid >= margin_start && mid <= margin_end {
                candidates.push(mid);
            }
        }
    }

    for i in 1..=12 {
        candidates.push(margin_start + (margin_end - margin_start) * (i as f64 / 13.0));
    }

    candidates.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    candidates.dedup_by(|a, b| (*a - *b).abs() < 0.45);
    candidates
}

fn score_hook_candidate(
    center: f64,
    seg_duration: f64,
    duration: f64,
    role: HookRole,
    speech: &[TimeRange],
    scene_times: &[f64],
) -> (f64, f64, f64) {
    let start = (center - seg_duration * 0.5)
        .max(0.0)
        .min((duration - seg_duration).max(0.0));
    let end = (start + seg_duration).min(duration);
    let speech_ratio = speech_ratio_in_window(speech, start, end);
    let motion = motion_score_in_window(scene_times, start, end);

    let target_frac = match role {
        HookRole::Teaser => 0.10,
        HookRole::Setup => 0.32,
        HookRole::Insight => 0.55,
        HookRole::Payoff => 0.82,
    };
    let position = (1.0 - ((center / duration.max(0.001)) - target_frac).abs() / 0.28).clamp(0.0, 1.0);
    let silence_penalty = if speech_ratio < 0.12 {
        0.4
    } else if speech_ratio < 0.22 {
        0.15
    } else {
        0.0
    };

    let score = match role {
        HookRole::Teaser => motion * 0.40 + speech_ratio * 0.35 + position * 0.25,
        HookRole::Setup => speech_ratio * 0.55 + motion * 0.30 + position * 0.15,
        HookRole::Insight => speech_ratio * 0.60 + motion * 0.25 + position * 0.15,
        HookRole::Payoff => motion * 0.40 + speech_ratio * 0.40 + position * 0.20,
    } - silence_penalty;

    (score, speech_ratio, motion)
}

fn segments_too_close(a: &PlannedHookSegment, start: f64, end: f64, min_gap: f64) -> bool {
    let gap = if a.end <= start {
        start - a.end
    } else if end <= a.start {
        a.start - end
    } else {
        -1.0
    };
    gap < min_gap
}

fn transition_text_between(from: &PlannedHookSegment, to: &PlannedHookSegment) -> String {
    const TEASER_SETUP: &[&str] = &[
        "The key insight…",
        "Here's what matters",
        "Now watch closely",
    ];
    const SETUP_INSIGHT: &[&str] = &[
        "Watch what happens next",
        "Most people miss this",
        "This is the tricky part",
    ];
    const INSIGHT_PAYOFF: &[&str] = &[
        "This is where it clicks",
        "Here's the breakthrough",
        "See it in action",
    ];

    let pool: &[&str] = match (from.role, to.role) {
        (HookRole::Teaser, HookRole::Setup) => TEASER_SETUP,
        (HookRole::Setup, HookRole::Insight) => SETUP_INSIGHT,
        (HookRole::Insight, HookRole::Payoff) => INSIGHT_PAYOFF,
        _ => &["Keep watching…"],
    };

    let mut idx =
        ((from.start * 17.0 + to.end * 31.0 + from.speech_ratio * 100.0) as usize) % pool.len();
    let mut text = pool[idx].to_string();

    if to.speech_ratio > 0.55 && matches!(to.role, HookRole::Setup | HookRole::Insight) {
        text = "Listen to this part".to_string();
        idx = 0;
    }
    if to.motion_score > 0.65 && to.role == HookRole::Payoff {
        text = "Watch what happens next".to_string();
    }
    if from.speech_ratio > 0.5 && to.motion_score > 0.5 && to.role == HookRole::Payoff {
        text = "Here's the breakthrough".to_string();
    }

    let words: Vec<&str> = text.split_whitespace().collect();
    if words.len() > 8 {
        text = words[..8].join(" ");
    }

    let _ = idx;
    text
}

fn hook_transition_start_times(durations: &[f64], crossfade: f64) -> Vec<f64> {
    let mut times = Vec::new();
    for index in 1..durations.len() {
        let offset: f64 = durations[..index].iter().sum::<f64>() - index as f64 * crossfade;
        times.push(offset.max(0.0));
    }
    times
}

fn resolve_hook_overlay_font() -> String {
    #[cfg(windows)]
    {
        return "C\\\\:/Windows/Fonts/segoeui.ttf".to_string();
    }
    #[cfg(target_os = "macos")]
    {
        return "/System/Library/Fonts/Supplemental/Arial Bold.ttf".to_string();
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        return "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf".to_string();
    }
    #[allow(unreachable_code)]
    "sans".to_string()
}

fn escape_drawtext_text(text: &str) -> String {
    text.replace('\\', "\\\\")
        .replace(':', "\\:")
        .replace('\'', "\\'")
        .replace('%', "\\%")
}

fn append_drawtext_overlay(
    filter: &mut String,
    input_label: &str,
    output_label: &str,
    text: &str,
    t_start: f64,
    t_end: f64,
    font: &str,
) {
    let escaped = escape_drawtext_text(text);
    let fade = 0.12_f64.min((t_end - t_start) * 0.25);
    let fade_in_end = t_start + fade;
    let fade_out_start = t_end - fade;
    filter.push_str(&format!(
        "[{input_label}]drawtext=fontfile={font}:text='{escaped}':fontsize=42:fontcolor=white:borderw=2:bordercolor=black@0.65:box=1:boxcolor=black@0.5:boxborderw=14:x=(w-text_w)/2:y=h*0.12:enable='between(t,{t_start:.3},{t_end:.3})':alpha='if(lt(t,{fade_in_end:.3}),(t-{t_start:.3})/{fade:.3},if(lt(t,{fade_out_start:.3}),1,({t_end:.3}-t)/{fade:.3}))'[{output_label}];"
    ));
}

fn build_hook_montage_filter(
    durations: &[f64],
    transitions: &[String],
    crossfade: f64,
) -> (String, String, String) {
    let xfade = build_phone_stitch_filter(durations, crossfade);
    if transitions.is_empty() {
        return (xfade, "vout".to_string(), "aout".to_string());
    }

    let font = resolve_hook_overlay_font();
    let transition_starts = hook_transition_start_times(durations, crossfade);
    let mut filter = xfade;
    let mut video_label = "vout".to_string();

    for (index, text) in transitions.iter().enumerate() {
        let t_start = transition_starts[index];
        let t_end = t_start + crossfade;
        let out_label = if index == transitions.len() - 1 {
            "vfinal".to_string()
        } else {
            format!("vt{index}")
        };
        append_drawtext_overlay(
            &mut filter,
            &video_label,
            &out_label,
            text,
            t_start,
            t_end,
            &font,
        );
        video_label = out_label;
    }

    let final_video = if video_label == "vout" {
        "vout".to_string()
    } else {
        video_label
    };
    (filter, final_video, "aout".to_string())
}

fn stitch_hook_montage(
    segment_paths: &[String],
    durations: &[f64],
    transitions: &[String],
    output_path: &str,
) -> Result<(), String> {
    if segment_paths.is_empty() {
        return Err("No hook segments to stitch".into());
    }
    if segment_paths.len() == 1 {
        fs::copy(&segment_paths[0], output_path).map_err(|e| e.to_string())?;
        return Ok(());
    }

    let crossfade = HOOK_CROSSFADE_SECS;
    let (filter, video_out, audio_out) =
        build_hook_montage_filter(durations, transitions, crossfade);
    let video_map = format!("[{video_out}]");
    let audio_map = format!("[{audio_out}]");

    let mut args = vec!["-y", "-hide_banner", "-nostdin"];
    for path in segment_paths {
        args.push("-i");
        args.push(path.as_str());
    }
    args.extend([
        "-filter_complex",
        &filter,
        "-map",
        &video_map,
        "-map",
        &audio_map,
        "-c:v",
        "libx264",
        "-preset",
        "fast",
        "-crf",
        "23",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-b:a",
        "192k",
        "-movflags",
        "+faststart",
        output_path,
    ]);

    run_ffmpeg_simple(&args, "Failed to stitch hook montage", false)
}

fn extract_hook_segment(
    main_path: &str,
    start: f64,
    end: f64,
    output_path: &str,
) -> Result<(), String> {
    let ss = format!("{start:.3}");
    let to = format!("{end:.3}");
    run_ffmpeg_simple(
        &[
            "-y",
            "-hide_banner",
            "-nostdin",
            "-ss",
            &ss,
            "-to",
            &to,
            "-i",
            main_path,
            "-c",
            "copy",
            "-avoid_negative_ts",
            "make_zero",
            output_path,
        ],
        "Failed to extract hook segment",
        false,
    )
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct HookPreviewProgressEvent {
    job_id: String,
    progress: f64,
    status: String,
    message: Option<String>,
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct HookPreviewCompleteEvent {
    job_id: String,
    clips: Vec<HookClipResult>,
    status: String,
    message: Option<String>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct HookPreviewStartResult {
    job_id: String,
}

fn emit_hook_progress(
    app: &tauri::AppHandle,
    job_id: &str,
    progress: f64,
    status: &str,
    message: Option<&str>,
) {
    let _ = app.emit(
        "hook-preview-progress",
        HookPreviewProgressEvent {
            job_id: job_id.to_string(),
            progress,
            status: status.to_string(),
            message: message.map(str::to_string),
        },
    );
}

fn emit_hook_complete(
    app: &tauri::AppHandle,
    job_id: &str,
    clips: Vec<HookClipResult>,
    status: &str,
    message: Option<&str>,
) {
    let _ = app.emit(
        "hook-preview-complete",
        HookPreviewCompleteEvent {
            job_id: job_id.to_string(),
            clips,
            status: status.to_string(),
            message: message.map(str::to_string),
        },
    );
}

fn plan_hook_segment_ranges(
    duration: f64,
    scene_times: &[f64],
    speech: &[TimeRange],
) -> Vec<PlannedHookSegment> {
    if duration <= 0.0 {
        return Vec::new();
    }

    if duration <= HOOK_MIN_TOTAL_SECS {
        return vec![PlannedHookSegment {
            start: 0.0,
            end: duration,
            role: HookRole::Teaser,
            speech_ratio: speech_ratio_in_window(speech, 0.0, duration),
            motion_score: motion_score_in_window(scene_times, 0.0, duration),
        }];
    }

    let crossfade_overlap =
        HOOK_CROSSFADE_SECS * (HOOK_CLIP_COUNT.saturating_sub(1) as f64);
    let target_total = HOOK_TARGET_TOTAL_SECS
        .min(duration * 0.45)
        .clamp(
            HOOK_MIN_TOTAL_SECS.min(duration),
            HOOK_MAX_TOTAL_SECS.min(duration),
        );
    let seg_duration = ((target_total + crossfade_overlap) / HOOK_CLIP_COUNT as f64)
        .clamp(HOOK_SEGMENT_MIN_SECS, HOOK_SEGMENT_MAX_SECS);

    let candidates = build_hook_candidate_centers(duration, scene_times, speech);
    let min_gap = seg_duration * 0.35;
    let roles = [
        HookRole::Teaser,
        HookRole::Setup,
        HookRole::Insight,
        HookRole::Payoff,
    ];

    let mut selected = Vec::new();
    for role in roles {
        let mut best: Option<PlannedHookSegment> = None;
        let mut best_score = f64::NEG_INFINITY;

        for &center in &candidates {
            let start = (center - seg_duration * 0.5)
                .max(0.0)
                .min((duration - seg_duration).max(0.0));
            let end = (start + seg_duration).min(duration);
            if end - start < 1.5 {
                continue;
            }

            if selected
                .iter()
                .any(|seg| segments_too_close(seg, start, end, min_gap))
            {
                continue;
            }

            let (score, speech_ratio, motion) =
                score_hook_candidate(center, seg_duration, duration, role, speech, scene_times);
            if score > best_score {
                best_score = score;
                best = Some(PlannedHookSegment {
                    start,
                    end,
                    role,
                    speech_ratio,
                    motion_score: motion,
                });
            }
        }

        if let Some(segment) = best {
            selected.push(segment);
        }
    }

    if selected.is_empty() {
        let end = target_total.min(duration);
        return vec![PlannedHookSegment {
            start: 0.0,
            end,
            role: HookRole::Teaser,
            speech_ratio: speech_ratio_in_window(speech, 0.0, end),
            motion_score: motion_score_in_window(scene_times, 0.0, end),
        }];
    }

    selected.sort_by_key(|segment| segment.role);
    selected
}

fn generate_hook_preview_core(
    app: &tauri::AppHandle,
    job_id: Option<&str>,
    main_path: &str,
) -> Result<Vec<HookClipResult>, String> {
    let emit = |progress: f64, status: &str, message: Option<&str>| {
        if let Some(id) = job_id {
            emit_hook_progress(app, id, progress, status, message);
        }
    };

    emit(5.0, "running", Some("Analyzing video for hook moments…"));
    validate_main_video_source(main_path)?;
    let duration = resolve_video_duration(main_path, None)?;

    let (scene_times, speech_regions) = std::thread::scope(|scope| {
        let main = main_path.to_string();
        let dur = duration;
        let scene_handle = scope.spawn(move || detect_scene_timestamps(&main, dur));
        let speech_handle = scope.spawn(move || detect_speech_regions(main_path, duration));
        let scenes = scene_handle.join().unwrap_or(Ok(Vec::new())).unwrap_or_default();
        let speech = speech_handle.join().unwrap_or(Ok(Vec::new())).unwrap_or_default();
        (scenes, speech)
    });

    emit(22.0, "running", Some("Selecting narrative hook clips…"));
    let planned = plan_hook_segment_ranges(duration, &scene_times, &speech_regions);

    if planned.is_empty() {
        return Err("Video is too short to generate a hook preview".into());
    }

    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let work_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("hooks")
        .join(format!("hook_{stamp}"));
    fs::create_dir_all(&work_dir).map_err(|e| e.to_string())?;

    let total = planned.len().max(1);
    let extract_results: std::sync::Mutex<Vec<Option<String>>> =
        std::sync::Mutex::new(vec![None; planned.len()]);
    let extract_err: std::sync::Mutex<Option<String>> = std::sync::Mutex::new(None);

    emit(28.0, "running", Some("Extracting hook segments…"));
    std::thread::scope(|scope| {
        for (i, segment) in planned.iter().enumerate() {
            let segment_path = work_dir.join(format!("hook_{i:02}.mp4"));
            let segment_str = segment_path.to_string_lossy().into_owned();
            let main = main_path.to_string();
            let err_slot = &extract_err;
            let out_slot = &extract_results;
            let start = segment.start;
            let end = segment.end;
            scope.spawn(move || {
                if let Err(e) = extract_hook_segment(&main, start, end, &segment_str) {
                    if let Ok(mut guard) = err_slot.lock() {
                        if guard.is_none() {
                            *guard = Some(e);
                        }
                    }
                    return;
                }
                if let Ok(mut guard) = out_slot.lock() {
                    guard[i] = Some(segment_str);
                }
            });
        }
    });

    if let Some(err) = extract_err.lock().ok().and_then(|g| g.clone()) {
        return Err(err);
    }

    let raw_paths = extract_results
        .into_inner()
        .map_err(|_| "Hook extraction interrupted".to_string())?;
    let mut segment_paths = Vec::new();
    for (i, item) in raw_paths.into_iter().enumerate() {
        let progress = 35.0 + ((i + 1) as f64 / total as f64) * 20.0;
        emit(
            progress,
            "running",
            Some(&format!("Extracted hook segment {} of {total}", i + 1)),
        );
        segment_paths.push(item.ok_or_else(|| format!("Hook segment {} failed to extract", i + 1))?);
    }

    emit(85.0, "running", Some("Finalizing hook clips…"));

    let mut final_results = Vec::new();
    for (i, segment) in planned.iter().enumerate() {
        let progress = 85.0 + ((i + 1) as f64 / total as f64) * 12.0;
        emit(
            progress,
            "running",
            Some(&format!("Hook {} of {total} ready", i + 1)),
        );
        final_results.push(HookClipResult {
            file_path: segment_paths[i].clone(),
            duration: (segment.end - segment.start).max(0.0),
            friendly_name: format!("Hook {}", i + 1),
        });
    }

    emit(100.0, "completed", Some("Hook preview ready"));
    Ok(final_results)
}

/// Analyze the main video and extract engaging 15–25s hook segments (blocking).
#[tauri::command]
fn generate_hook_preview(app: tauri::AppHandle, main_path: String) -> Result<Vec<HookClipResult>, String> {
    generate_hook_preview_core(&app, None, &main_path)
}

/// Start hook generation on a background thread with progress events.
#[tauri::command]
fn start_generate_hook_preview(app: tauri::AppHandle, main_path: String) -> Result<HookPreviewStartResult, String> {
    if main_path.is_empty() {
        return Err("No main video loaded".into());
    }

    let job_id = format!(
        "hook_{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or(0)
    );

    let app_thread = app.clone();
    let main = main_path.clone();
    let job_for_thread = job_id.clone();

    std::thread::spawn(move || {
        let result = generate_hook_preview_core(&app_thread, Some(&job_for_thread), &main);
        match result {
            Ok(clips) => {
                emit_hook_complete(&app_thread, &job_for_thread, clips, "completed", None);
            }
            Err(err) => {
                emit_hook_complete(
                    &app_thread,
                    &job_for_thread,
                    Vec::new(),
                    "failed",
                    Some(&err),
                );
            }
        }
    });

    Ok(HookPreviewStartResult { job_id })
}

fn build_timeline_parts(source_duration: f64, segments: &[TimelapseSegmentInput]) -> Vec<TimelinePart> {
    let mut sorted = segments.to_vec();
    sorted.sort_by(|a, b| {
        a.start_time
            .partial_cmp(&b.start_time)
            .unwrap_or(std::cmp::Ordering::Equal)
    });

    let mut parts = Vec::new();
    let mut cursor = 0.0;

    for seg in sorted {
        let start = seg.start_time.max(0.0);
        let end = seg.end_time.min(source_duration);
        if end <= start {
            continue;
        }
        if start > cursor {
            parts.push(TimelinePart {
                start: cursor,
                end: start,
                speed: 1.0,
            });
        }
        let speed = seg.speed_factor.max(1.0);
        parts.push(TimelinePart {
            start,
            end,
            speed,
        });
        cursor = end;
    }

    if cursor < source_duration {
        parts.push(TimelinePart {
            start: cursor,
            end: source_duration,
            speed: 1.0,
        });
    }

    parts
}

fn output_duration(parts: &[TimelinePart]) -> f64 {
    parts
        .iter()
        .map(|p| (p.end - p.start) / p.speed)
        .sum()
}

/// Preview bake: stream-copy normal sections (instant), only re-encode timelapse spans.
fn bake_preview_segmented(
    app: &tauri::AppHandle,
    bake_state: &SharedBakeState,
    job_id: &str,
    input_path: &str,
    parts: &[TimelinePart],
    output_path: &str,
    out_duration: f64,
    work_dir: &PathBuf,
) -> Result<(), String> {
    cancel_active_bake(app, bake_state, "Superseded by a newer bake")?;
    if work_dir.exists() {
        let _ = fs::remove_dir_all(work_dir);
    }
    fs::create_dir_all(work_dir).map_err(|e| e.to_string())?;

    let progress_file = work_dir.join("ffmpeg_progress.txt");
    let mut concat_lines = String::new();
    let mut completed_out = 0.0;
    let start = Instant::now();

    emit_bake_progress(app, job_id, 0.0, 0, "running", None);

    for (i, part) in parts.iter().enumerate() {
        let segment_path = work_dir.join(format!("segment_{i:03}.mp4"));
        let segment_str = segment_path.to_string_lossy().into_owned();
        let part_out = part_output_duration(part);

        if is_unit_speed(part.speed) {
            let ss = format!("{:.3}", part.start);
            let to = format!("{:.3}", part.end);
            run_ffmpeg_simple(
                &[
                    "-y",
                    "-hide_banner",
                    "-nostdin",
                    "-ss",
                    &ss,
                    "-to",
                    &to,
                    "-i",
                    input_path,
                    "-map",
                    "0:v:0?",
                    "-an",
                    "-c:v",
                    "copy",
                    "-avoid_negative_ts",
                    "make_zero",
                    "-movflags",
                    "+faststart",
                    &segment_str,
                ],
                "Failed to copy timeline segment",
                true,
            )?;
        } else {
            let ss = format!("{:.3}", part.start);
            let to = format!("{:.3}", part.end);
            let vf = format!(
                "setpts=PTS-STARTPTS,setpts=PTS/{:.4}",
                part.speed
            );
            let _ = fs::remove_file(&progress_file);
            let progress_arg = progress_file.to_string_lossy().into_owned();
            run_ffmpeg_with_progress(
                app,
                bake_state,
                job_id,
                &[
                    "-y",
                    "-hide_banner",
                    "-nostdin",
                    "-progress",
                    &progress_arg,
                    "-stats_period",
                    "0.25",
                    "-ss",
                    &ss,
                    "-to",
                    &to,
                    "-i",
                    input_path,
                    "-an",
                    "-vf",
                    &vf,
                    "-c:v",
                    "libx264",
                    "-preset",
                    "ultrafast",
                    "-crf",
                    "28",
                    "-pix_fmt",
                    "yuv420p",
                    "-threads",
                    "1",
                    "-movflags",
                    "+faststart",
                    &segment_str,
                ],
                part_out,
                "Failed to encode timelapse segment",
                true,
                false,
            )?;
        }

        completed_out += part_out;
        let pct = if out_duration > 0.0 {
            (completed_out / out_duration * 92.0).clamp(0.0, 92.0)
        } else {
            0.0
        };
        emit_bake_progress(
            app,
            job_id,
            pct,
            start.elapsed().as_millis() as u64,
            "running",
            None,
        );

        concat_lines.push_str(&format!(
            "file '{}'\n",
            concat_list_path(&segment_str)
        ));
    }

    let list_file = work_dir.join("concat_list.txt");
    fs::write(&list_file, concat_lines).map_err(|e| e.to_string())?;
    let list_str = list_file.to_string_lossy().into_owned();

    let concat_copy = run_ffmpeg_simple(
        &[
            "-y",
            "-hide_banner",
            "-nostdin",
            "-f",
            "concat",
            "-safe",
            "0",
            "-i",
            &list_str,
            "-an",
            "-c:v",
            "copy",
            "-movflags",
            "+faststart",
            output_path,
        ],
        "Failed to concat preview segments",
        true,
    );

    if concat_copy.is_err() {
        run_ffmpeg_simple(
            &[
                "-y",
                "-hide_banner",
                "-nostdin",
                "-f",
                "concat",
                "-safe",
                "0",
                "-i",
                &list_str,
                "-an",
                "-c:v",
                "libx264",
                "-preset",
                "ultrafast",
                "-crf",
                "30",
                "-pix_fmt",
                "yuv420p",
                "-movflags",
                "+faststart",
                output_path,
            ],
            "Failed to concat preview segments (fallback encode)",
            true,
        )?;
    }

    emit_bake_progress(
        app,
        job_id,
        100.0,
        start.elapsed().as_millis() as u64,
        "completed",
        None,
    );

    let _ = fs::remove_dir_all(work_dir);
    Ok(())
}

fn build_video_filter(parts: &[TimelinePart]) -> String {
    let mut filter = String::new();
    let mut labels = Vec::new();

    for (i, part) in parts.iter().enumerate() {
        let label = format!("v{i}");
        if (part.speed - 1.0).abs() < 0.01 {
            filter.push_str(&format!(
                "[0:v]trim=start={}:end={},setpts=PTS-STARTPTS[{}];",
                part.start, part.end, label
            ));
        } else {
            filter.push_str(&format!(
                "[0:v]trim=start={}:end={},setpts=PTS-STARTPTS,setpts=PTS/{:.4}[{}];",
                part.start, part.end, part.speed, label
            ));
        }
        labels.push(label);
    }

    let inputs: String = labels.iter().map(|l| format!("[{l}]")).collect();
    filter.push_str(&format!(
        "{}concat=n={}:v=1:a=0[basev];",
        inputs,
        parts.len()
    ));
    filter
}

fn build_atempo_chain(speed: f64) -> String {
    if speed <= 1.0001 {
        return String::new();
    }
    let mut chain = Vec::new();
    let mut remaining = speed;
    while remaining > 2.0001 {
        chain.push("atempo=2".to_string());
        remaining /= 2.0;
    }
    if remaining > 1.0001 {
        chain.push(format!("atempo={remaining:.4}"));
    }
    chain.join(",")
}

fn build_audio_base_filter(parts: &[TimelinePart]) -> String {
    build_audio_base_filter_from_input(0, parts)
}

fn build_audio_base_filter_from_input(input_idx: usize, parts: &[TimelinePart]) -> String {
    let mut filter = String::new();
    let mut labels = Vec::new();

    for (i, part) in parts.iter().enumerate() {
        let label = format!("a{i}");
        let atempo = build_atempo_chain(part.speed);
        if atempo.is_empty() {
            filter.push_str(&format!(
                "[{input_idx}:a]atrim=start={}:end={},asetpts=PTS-STARTPTS[{}];",
                part.start, part.end, label
            ));
        } else {
            filter.push_str(&format!(
                "[{input_idx}:a]atrim=start={}:end={},asetpts=PTS-STARTPTS,{}[{}];",
                part.start, part.end, atempo, label
            ));
        }
        labels.push(label);
    }

    let inputs: String = labels.iter().map(|l| format!("[{l}]")).collect();
    filter.push_str(&format!(
        "{}concat=n={}:v=0:a=1[basea];",
        inputs,
        parts.len()
    ));
    filter
}

fn source_to_output_time(source_time: f64, parts: &[TimelinePart]) -> f64 {
    let mut output = 0.0;
    for part in parts {
        if source_time <= part.start {
            break;
        }
        let span_end = source_time.min(part.end);
        output += (span_end - part.start) / part.speed;
        if source_time <= part.end {
            break;
        }
    }
    output
}

fn timeline_to_output_time(
    timeline_time: f64,
    main_timeline_start: f64,
    lead_in_duration: f64,
    parts: &[TimelinePart],
) -> f64 {
    if timeline_time < main_timeline_start - 0.001 {
        return timeline_time;
    }
    let source_time = (timeline_time - main_timeline_start).max(0.0);
    lead_in_duration + source_to_output_time(source_time, parts)
}

fn append_lead_in_video_pad(filter: &mut String, lead_in: f64, input_label: &str) -> String {
    if lead_in <= 0.001 {
        return input_label.to_string();
    }
    let padded = format!("{input_label}padded");
    filter.push_str(&format!(
        "[{input_label}]tpad=start_duration={lead_in:.4}:start_mode=add:color=black[{padded}];"
    ));
    padded
}

fn append_lead_in_audio_pad(filter: &mut String, lead_in: f64, input_label: &str) -> String {
    if lead_in <= 0.001 {
        return input_label.to_string();
    }
    let delay_ms = (lead_in * 1000.0).round() as i64;
    let padded = format!("{input_label}padded");
    filter.push_str(&format!(
        "[{input_label}]adelay={delay_ms}|{delay_ms}[{padded}];"
    ));
    padded
}

fn overlay_track_priority(track: &str) -> i32 {
    match track {
        "hook" => 4,
        "intro" => 3,
        "outro" => 2,
        "broll" => 1,
        "diagram" => 1,
        _ => 0,
    }
}

fn has_audio_stream(path: &str) -> bool {
    let Ok(mut command) = tool_command("ffprobe") else {
        return false;
    };

    let output = command
        .args([
            "-v",
            "error",
            "-select_streams",
            "a:0",
            "-show_entries",
            "stream=index",
            "-of",
            "csv=p=0",
            path,
        ])
        .output();

    match output {
        Ok(result) => !result.stdout.is_empty(),
        Err(_) => false,
    }
}

fn build_export_filter(
    parts: &[TimelinePart],
    overlays: &[OverlayClipInput],
    include_audio: bool,
    settings: &ExportSettingsInput,
    lead_in_duration: f64,
    main_timeline_start: f64,
) -> String {
    let mut filter = build_video_filter(parts);
    let mut current_video = append_lead_in_video_pad(&mut filter, lead_in_duration, "basev");
    if include_audio {
        filter.push_str(&build_audio_base_filter(parts));
        append_lead_in_audio_pad(&mut filter, lead_in_duration, "basea");
    }

    let mut sorted: Vec<&OverlayClipInput> = overlays.iter().collect();
    sorted.sort_by(|a, b| {
        a.start_time
            .partial_cmp(&b.start_time)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| {
                overlay_track_priority(&a.track).cmp(&overlay_track_priority(&b.track))
            })
    });

    for (i, clip) in sorted.iter().enumerate() {
        let input_idx = i + 1;
        let prep = format!("ovprep{i}");
        let scaled = format!("ovscaled{i}");
        let base_ref = format!("bvr{i}");
        let out = format!("xv{i}");

        let out_start = timeline_to_output_time(
            clip.start_time,
            main_timeline_start,
            lead_in_duration,
            parts,
        );
        let out_end = timeline_to_output_time(
            clip.start_time + clip.duration,
            main_timeline_start,
            lead_in_duration,
            parts,
        );

        if clip.is_image {
            filter.push_str(&format!(
                "[{input_idx}:v]scale=iw:ih,setpts=PTS-STARTPTS[{prep}];"
            ));
        } else {
            filter.push_str(&format!(
                "[{input_idx}:v]trim=0:{:.4},setpts=PTS-STARTPTS[{prep}];",
                clip.duration
            ));
        }

        filter.push_str(&format!(
            "[{prep}][{current_video}]scale2ref[{}][{}];",
            scaled, base_ref
        ));
        filter.push_str(&format!(
            "[{}][{}]overlay=enable='between(t\\,{:.4}\\,{:.4})':x=0:y=0:eof_action=pass[{}];",
            base_ref, scaled, out_start, out_end, out
        ));
        current_video = out;
    }

    append_final_video_output(&mut filter, &current_video, settings);

    filter
}

#[tauri::command]
fn apply_timelapse_segments(
    app: tauri::AppHandle,
    bake_state: tauri::State<'_, SharedBakeState>,
    input_path: String,
    segments: Vec<TimelapseSegmentInput>,
    source_duration: Option<f64>,
    preview_mode: Option<bool>,
    job_id: Option<String>,
) -> Result<TimelapseBakeResult, String> {
    if input_path.is_empty() {
        return Err("No input video".into());
    }
    if segments.is_empty() {
        return Err("No timelapse regions defined".into());
    }
    if !PathBuf::from(&input_path).exists() {
        return Err("Input video file not found".into());
    }

    let preview = preview_mode.unwrap_or(true);
    let job_id = job_id.unwrap_or_else(|| "bake".to_string());

    let source_len = resolve_source_length(&input_path, source_duration)?;

    let parts = build_timeline_parts(source_len, &segments);
    if parts.is_empty() {
        return Err("No valid timelapse regions".into());
    }

    let out_duration = output_duration(&parts);

    let app_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?;
    fs::create_dir_all(&app_dir).map_err(|e| e.to_string())?;

    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let prefix = if preview {
        "preview_timelapse"
    } else {
        "master_timelapse"
    };
    let output_path = app_dir
        .join(format!("{prefix}_{stamp}.mp4"))
        .to_string_lossy()
        .into_owned();

    let shared_state = Arc::clone(bake_state.inner());

    if preview {
        let work_dir = app_dir.join(format!("bake_work_{job_id}"));
        let app_for_thread = app.clone();
        let job_id_for_thread = job_id.clone();
        let input_for_thread = input_path.clone();
        let output_for_thread = output_path.clone();
        let parts_for_thread = parts.clone();
        std::thread::spawn(move || {
            let result = bake_preview_segmented(
                &app_for_thread,
                &shared_state,
                &job_id_for_thread,
                &input_for_thread,
                &parts_for_thread,
                &output_for_thread,
                out_duration,
                &work_dir,
            );
            match result {
                Ok(()) => emit_bake_complete(
                    &app_for_thread,
                    &job_id_for_thread,
                    &output_for_thread,
                    out_duration,
                    "completed",
                    None,
                ),
                Err(err) => emit_bake_complete(
                    &app_for_thread,
                    &job_id_for_thread,
                    "",
                    out_duration,
                    "failed",
                    Some(&err),
                ),
            }
        });

        return Ok(TimelapseBakeResult {
            job_id,
            output_path: String::new(),
            duration: out_duration,
            async_started: true,
        });
    }

    let mut filter = build_video_filter(&parts);
    filter.push_str("[basev]format=yuv420p[outv];");
    let ffmpeg_args: Vec<String> = vec![
        "-y".into(),
        "-hide_banner".into(),
        "-nostdin".into(),
        "-i".into(),
        input_path.clone(),
        "-filter_complex".into(),
        filter,
        "-map".into(),
        "[outv]".into(),
        "-c:v".into(),
        "libx264".into(),
        "-preset".into(),
        "fast".into(),
        "-crf".into(),
        "23".into(),
        "-pix_fmt".into(),
        "yuv420p".into(),
        "-movflags".into(),
        "+faststart".into(),
        output_path.clone(),
    ];
    let arg_refs: Vec<&str> = ffmpeg_args.iter().map(String::as_str).collect();
    run_ffmpeg_with_progress(
        &app,
        bake_state.inner(),
        &job_id,
        &arg_refs,
        out_duration,
        "FFmpeg timelapse export failed",
        false,
        true,
    )?;

    Ok(TimelapseBakeResult {
        job_id,
        output_path,
        duration: out_duration,
        async_started: false,
    })
}

fn has_timelapse_parts(parts: &[TimelinePart]) -> bool {
    parts.iter().any(|p| !is_unit_speed(p.speed))
}

fn build_overlay_filter_on_base(
    overlays: &[OverlayClipInput],
    parts: &[TimelinePart],
    overlay_input_start: usize,
    settings: &ExportSettingsInput,
    lead_in_duration: f64,
    main_timeline_start: f64,
) -> String {
    let mut filter = String::new();
    let mut sorted: Vec<&OverlayClipInput> = overlays.iter().collect();
    sorted.sort_by(|a, b| {
        a.start_time
            .partial_cmp(&b.start_time)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| {
                overlay_track_priority(&a.track).cmp(&overlay_track_priority(&b.track))
            })
    });

    let mut current_video = "basev".to_string();
    filter.push_str("[0:v]setpts=PTS-STARTPTS,format=yuv420p[basev];");

    for (i, clip) in sorted.iter().enumerate() {
        let input_idx = i + overlay_input_start;
        let prep = format!("ovprep{i}");
        let scaled = format!("ovscaled{i}");
        let base_ref = format!("bvr{i}");
        let out = format!("xv{i}");

        let out_start = timeline_to_output_time(
            clip.start_time,
            main_timeline_start,
            lead_in_duration,
            parts,
        );
        let out_end = timeline_to_output_time(
            clip.start_time + clip.duration,
            main_timeline_start,
            lead_in_duration,
            parts,
        );

        if clip.is_image {
            filter.push_str(&format!(
                "[{input_idx}:v]scale=iw:ih,setpts=PTS-STARTPTS[{prep}];"
            ));
        } else {
            filter.push_str(&format!(
                "[{input_idx}:v]trim=0:{:.4},setpts=PTS-STARTPTS[{prep}];",
                clip.duration
            ));
        }

        filter.push_str(&format!(
            "[{prep}][{current_video}]scale2ref[{}][{}];",
            scaled, base_ref
        ));
        filter.push_str(&format!(
            "[{}][{}]overlay=enable='between(t\\,{:.4}\\,{:.4})':x=0:y=0:eof_action=pass[{}];",
            base_ref, scaled, out_start, out_end, out
        ));
        current_video = out;
    }

    append_final_video_output(&mut filter, &current_video, settings);
    filter
}

fn export_audio_map_label(lead_in_duration: f64) -> &'static str {
    if lead_in_duration > 0.001 {
        "baseapadded"
    } else {
        "basea"
    }
}

fn export_stream_copy(
    app: &tauri::AppHandle,
    job_id: &str,
    cancel: &AtomicBool,
    main_path: &str,
    output_path: &str,
    include_audio: bool,
    source_duration: f64,
    export_start: Instant,
) -> Result<(), String> {
    let mut args = vec!["-y", "-hide_banner", "-nostdin", "-i", main_path];
    if include_audio {
        args.extend(["-c", "copy", output_path]);
    } else {
        args.extend(["-c:v", "copy", "-an", output_path]);
    }
    run_ffmpeg_export_encode(
        app,
        job_id,
        cancel,
        &args,
        "FFmpeg export failed",
        source_duration,
        0.0,
        source_duration,
        export_start,
        "Copying video to export file",
        0.0,
        95.0,
    )
}

fn export_segmented_base_video(
    app: &tauri::AppHandle,
    job_id: &str,
    cancel: &AtomicBool,
    input_path: &str,
    parts: &[TimelinePart],
    output_path: &str,
    work_dir: &PathBuf,
    out_duration: f64,
    profile: &ExportEncodeProfile,
) -> Result<(), String> {
    if work_dir.exists() {
        let _ = fs::remove_dir_all(work_dir);
    }
    fs::create_dir_all(work_dir).map_err(|e| e.to_string())?;

    let thread_limit = ffmpeg_thread_limit_export();
    let mut concat_lines = String::new();
    let mut completed_out = 0.0;
    let start = Instant::now();

    emit_export_progress(
        app,
        job_id,
        0.0,
        0,
        "running",
        Some("Preparing segments"),
    );

    for (i, part) in parts.iter().enumerate() {
        check_export_cancel(cancel)?;

        let segment_path = work_dir.join(format!("segment_{i:03}.mp4"));
        let segment_str = segment_path.to_string_lossy().into_owned();
        let part_out = part_output_duration(part);
        let encoded_timelapse = !is_unit_speed(part.speed);

        if is_unit_speed(part.speed) {
            let ss = format!("{:.3}", part.start);
            let to = format!("{:.3}", part.end);
            run_ffmpeg_simple(
                &[
                    "-y",
                    "-hide_banner",
                    "-nostdin",
                    "-ss",
                    &ss,
                    "-to",
                    &to,
                    "-i",
                    input_path,
                    "-map",
                    "0:v:0?",
                    "-an",
                    "-c:v",
                    "copy",
                    "-avoid_negative_ts",
                    "make_zero",
                    &segment_str,
                ],
                "Failed to copy timeline segment",
                false,
            )?;
        } else {
            let ss = format!("{:.3}", part.start);
            let to = format!("{:.3}", part.end);
            let vf = format!("setpts=PTS-STARTPTS,setpts=PTS/{:.4}", part.speed);
            let speed_label = format!("{:.0}", part.speed);
            let encode_msg = format!("Encoding timelapse {speed_label}× segment");
            let thread_limit_ref = thread_limit.as_str();
            run_ffmpeg_export_encode(
                app,
                job_id,
                cancel,
                &[
                    "-y",
                    "-hide_banner",
                    "-nostdin",
                    "-ss",
                    &ss,
                    "-to",
                    &to,
                    "-i",
                    input_path,
                    "-an",
                    "-vf",
                    &vf,
                    "-c:v",
                    "libx264",
                    "-preset",
                    profile.preset,
                    "-crf",
                    profile.crf,
                    "-pix_fmt",
                    "yuv420p",
                    "-threads",
                    thread_limit_ref,
                    &segment_str,
                ],
                "Failed to encode timelapse segment",
                part_out,
                completed_out,
                out_duration,
                start,
                &encode_msg,
                0.0,
                75.0,
            )?;
        }

        completed_out += part_out;
        let pct = if out_duration > 0.0 {
            (completed_out / out_duration * 75.0).clamp(0.0, 75.0)
        } else {
            0.0
        };
        emit_export_progress(
            app,
            job_id,
            pct,
            start.elapsed().as_millis() as u64,
            "running",
            Some(if encoded_timelapse {
                "Timelapse segment done"
            } else {
                "Copied segment"
            }),
        );

        concat_lines.push_str(&format!(
            "file '{}'\n",
            concat_list_path(&segment_str)
        ));
    }

    check_export_cancel(cancel)?;

    let list_file = work_dir.join("concat_list.txt");
    fs::write(&list_file, concat_lines).map_err(|e| e.to_string())?;
    let list_str = list_file.to_string_lossy().into_owned();

    let concat_copy = run_ffmpeg_export_encode(
        app,
        job_id,
        cancel,
        &[
            "-y",
            "-hide_banner",
            "-nostdin",
            "-f",
            "concat",
            "-safe",
            "0",
            "-i",
            &list_str,
            "-an",
            "-c:v",
            "copy",
            output_path,
        ],
        "Failed to concat export segments",
        out_duration,
        0.0,
        out_duration,
        start,
        "Joining segments",
        75.0,
        15.0,
    );

    if concat_copy.is_err() {
        run_ffmpeg_export_encode(
            app,
            job_id,
            cancel,
            &[
                "-y",
                "-hide_banner",
                "-nostdin",
                "-f",
                "concat",
                "-safe",
                "0",
                "-i",
                &list_str,
                "-an",
                "-c:v",
                "libx264",
                "-preset",
                "ultrafast",
                "-crf",
                "23",
                "-pix_fmt",
                "yuv420p",
                "-threads",
                &thread_limit,
                output_path,
            ],
            "Failed to concat export segments (fallback encode)",
            out_duration,
            0.0,
            out_duration,
            start,
            "Joining segments (re-encode)",
            75.0,
            15.0,
        )?;
    }

    Ok(())
}

fn export_with_filter_graph(
    app: &tauri::AppHandle,
    job_id: &str,
    cancel: &AtomicBool,
    main_path: &str,
    output_path: &str,
    parts: &[TimelinePart],
    overlay_clips: &[OverlayClipInput],
    include_audio: bool,
    base_input: Option<&str>,
    out_duration: f64,
    export_start: Instant,
    settings: &ExportSettingsInput,
    lead_in_duration: f64,
    main_timeline_start: f64,
) -> Result<(), String> {
    let thread_limit = ffmpeg_thread_limit_export();
    let filter = if base_input.is_some() {
        let overlay_input_start = if include_audio { 2 } else { 1 };
        let mut filter = String::new();
        if !overlay_clips.is_empty() {
            filter.push_str(&build_overlay_filter_on_base(
                overlay_clips,
                parts,
                overlay_input_start,
                settings,
                lead_in_duration,
                main_timeline_start,
            ));
        } else {
            let mut base_only = String::from("[0:v]setpts=PTS-STARTPTS[basev];");
            append_final_video_output(&mut base_only, "basev", settings);
            filter.push_str(&base_only);
        }
        if include_audio {
            filter.push_str(&build_audio_base_filter_from_input(1, parts));
        }
        filter
    } else {
        build_export_filter(
            parts,
            overlay_clips,
            include_audio,
            settings,
            lead_in_duration,
            main_timeline_start,
        )
    };

    let mut args: Vec<String> = vec![
        "-y".into(),
        "-hide_banner".into(),
        "-nostdin".into(),
    ];

    if let Some(base) = base_input {
        args.push("-i".into());
        args.push(base.to_string());
    } else {
        args.push("-i".into());
        args.push(main_path.to_string());
    }

    // Second main input only when muxing audio from source onto a pre-baked base video.
    // Single-pass build_export_filter reads [0:v] and [0:a] from one input.
    if include_audio && base_input.is_some() {
        args.push("-i".into());
        args.push(main_path.to_string());
    }

    for clip in overlay_clips {
        if clip.is_image {
            args.push("-loop".into());
            args.push("1".into());
            args.push("-t".into());
            args.push(format!("{:.4}", clip.duration));
        }
        args.push("-i".into());
        args.push(clip.file_path.clone());
    }

    args.push("-filter_complex".into());
    args.push(filter);
    args.push("-map".into());
    args.push("[outv]".into());
    if include_audio {
        args.push("-map".into());
        args.push(format!("[{}]", export_audio_map_label(lead_in_duration)));
        args.push("-c:a".into());
        args.push("aac".into());
        args.push("-b:a".into());
        args.push("192k".into());
        args.push("-shortest".into());
    } else {
        args.push("-an".into());
    }

    if base_input.is_some() && overlay_clips.is_empty() && include_audio {
        args.push("-c:v".into());
        args.push("copy".into());
    } else if base_input.is_some() && overlay_clips.is_empty() && !include_audio {
        // Base video is already the final output — caller should rename instead.
        return Err("Internal export error: redundant finalize pass".into());
    } else {
        let profile = export_encode_profile(&settings.quality_preset);
        args.push("-c:v".into());
        args.push("libx264".into());
        args.push("-preset".into());
        args.push(profile.preset.into());
        args.push("-crf".into());
        args.push(profile.crf.into());
        args.push("-pix_fmt".into());
        args.push("yuv420p".into());
        args.push("-threads".into());
        args.push(thread_limit);
        if settings.quality_preset == "youtube" {
            args.push("-movflags".into());
            args.push("+faststart".into());
        }
    }

    args.push(output_path.to_string());

    let status_message = if base_input.is_some() && overlay_clips.is_empty() && include_audio {
        "Adding audio track"
    } else {
        "Encoding export"
    };

    let arg_refs: Vec<&str> = args.iter().map(String::as_str).collect();
    run_ffmpeg_export_encode(
        app,
        job_id,
        cancel,
        &arg_refs,
        "FFmpeg export failed",
        out_duration,
        0.0,
        out_duration,
        export_start,
        status_message,
        90.0,
        9.0,
    )
}

fn export_mp4_sync(
    app: &tauri::AppHandle,
    job_id: &str,
    cancel: &AtomicBool,
    main_path: String,
    output_path: String,
    timelapse_segments: Vec<TimelapseSegmentInput>,
    overlay_clips: Vec<OverlayClipInput>,
    source_duration: Option<f64>,
    export_settings: ExportSettingsInput,
    lead_in_duration: Option<f64>,
    main_timeline_start: Option<f64>,
) -> Result<ExportMp4Result, String> {
    if main_path.is_empty() {
        return Err("No main video loaded".into());
    }
    if output_path.is_empty() {
        return Err("No output path selected".into());
    }
    if !PathBuf::from(&main_path).exists() {
        return Err("Main video file not found".into());
    }

    if let Some(parent) = PathBuf::from(&output_path).parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    for clip in &overlay_clips {
        if !PathBuf::from(&clip.file_path).exists() {
            return Err(format!("Overlay file not found: {}", clip.file_path));
        }
    }

    let source_len = resolve_video_duration(&main_path, source_duration)?;
    let parts = if timelapse_segments.is_empty() {
        vec![TimelinePart {
            start: 0.0,
            end: source_len,
            speed: 1.0,
        }]
    } else {
        build_timeline_parts(source_len, &timelapse_segments)
    };

    if parts.is_empty() {
        return Err("No valid timeline to export".into());
    }

    let lead_in = lead_in_duration.unwrap_or(0.0).max(0.0);
    let main_start = main_timeline_start.unwrap_or(0.0).max(0.0);
    let out_duration = lead_in + output_duration(&parts);
    let include_audio = has_audio_stream(&main_path);
    let start = Instant::now();
    let temp_output = temp_export_path(&output_path);

    check_export_cancel(cancel)?;
    emit_export_progress(&app, job_id, 0.0, 0, "running", Some("Starting background export"));

    let export_result = (|| {
        let can_stream_copy = lead_in <= 0.001
            && !has_timelapse_parts(&parts)
            && overlay_clips.is_empty()
            && !needs_video_reencode(&export_settings);

        if can_stream_copy {
            check_export_cancel(cancel)?;
            export_stream_copy(
                &app,
                job_id,
                cancel,
                &main_path,
                &temp_output,
                include_audio,
                source_len,
                start,
            )?;
        } else if has_timelapse_parts(&parts) {
            // Single filter_complex pass keeps video setpts, audio atempo, and b-roll overlays
            // on one shared output timeline (segmented concat + second pass misaligns A/V and drops overlays).
            check_export_cancel(cancel)?;
            export_with_filter_graph(
                &app,
                job_id,
                cancel,
                &main_path,
                &temp_output,
                &parts,
                &overlay_clips,
                include_audio,
                None,
                out_duration,
                start,
                &export_settings,
                lead_in,
                main_start,
            )?;
        } else {
            check_export_cancel(cancel)?;
            export_with_filter_graph(
                &app,
                job_id,
                cancel,
                &main_path,
                &temp_output,
                &parts,
                &overlay_clips,
                include_audio,
                None,
                out_duration,
                start,
                &export_settings,
                lead_in,
                main_start,
            )?;
        }

        finalize_export_file(&temp_output, &output_path)?;

        emit_export_progress(
            &app,
            job_id,
            100.0,
            start.elapsed().as_millis() as u64,
            "completed",
            None,
        );

        Ok(ExportMp4Result {
            output_path,
            duration: out_duration,
        })
    })();

    if export_result.is_err() {
        cleanup_temp_export(&temp_output);
    }

    export_result
}

#[tauri::command]
fn start_export_mp4(
    app: tauri::AppHandle,
    export_state: tauri::State<'_, SharedExportState>,
    main_path: String,
    output_path: String,
    timelapse_segments: Vec<TimelapseSegmentInput>,
    overlay_clips: Vec<OverlayClipInput>,
    source_duration: Option<f64>,
    lead_in_duration: Option<f64>,
    main_timeline_start: Option<f64>,
    export_settings: Option<ExportSettingsInput>,
) -> Result<ExportStartResult, String> {
    if main_path.is_empty() {
        return Err("No main video loaded".into());
    }
    if output_path.is_empty() {
        return Err("No output path selected".into());
    }

    {
        let state = export_state.lock().map_err(|e| e.to_string())?;
        if state.job_id.is_some() {
            return Err("An export is already running in the background".into());
        }
    }

    let job_id = format!(
        "export_{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or(0)
    );

    let cancel = Arc::new(AtomicBool::new(false));
    {
        let mut state = export_state.lock().map_err(|e| e.to_string())?;
        state.cancel = cancel.clone();
        state.job_id = Some(job_id.clone());
    }

    let shared = Arc::clone(export_state.inner());
    let app_for_thread = app.clone();
    let output_for_result = output_path.clone();
    let job_id_for_thread = job_id.clone();
    let settings = export_settings.unwrap_or_default();

    std::thread::spawn(move || {
        let result = export_mp4_sync(
            &app_for_thread,
            &job_id_for_thread,
            &cancel,
            main_path,
            output_for_result.clone(),
            timelapse_segments,
            overlay_clips,
            source_duration,
            settings,
            lead_in_duration,
            main_timeline_start,
        );

        if let Ok(mut state) = shared.lock() {
            state.job_id = None;
            state.cancel.store(false, Ordering::Relaxed);
        }

        match result {
            Ok(done) => {
                emit_export_complete(
                    &app_for_thread,
                    &job_id_for_thread,
                    &done.output_path,
                    done.duration,
                    "completed",
                    None,
                );
            }
            Err(err) => {
                let status = if err.contains("cancelled") {
                    "cancelled"
                } else {
                    "failed"
                };
                emit_export_progress(
                    &app_for_thread,
                    &job_id_for_thread,
                    0.0,
                    0,
                    status,
                    Some(&err),
                );
                emit_export_complete(
                    &app_for_thread,
                    &job_id_for_thread,
                    "",
                    0.0,
                    status,
                    Some(&err),
                );
            }
        }
    });

    Ok(ExportStartResult {
        job_id,
        output_path,
        async_started: true,
    })
}

#[tauri::command]
fn cancel_export_mp4(export_state: tauri::State<'_, SharedExportState>) -> Result<(), String> {
    let state = export_state.lock().map_err(|e| e.to_string())?;
    if state.job_id.is_none() {
        return Err("No background export is running".into());
    }
    state.cancel.store(true, Ordering::Relaxed);
    Ok(())
}

#[tauri::command]
fn start_phone_upload_server(
    app: tauri::AppHandle,
    upload_state: tauri::State<'_, SharedPhoneUploadState>,
) -> Result<phone_upload::PhoneUploadServerInfo, String> {
    let mut runtime = upload_state.lock().map_err(|e| e.to_string())?;
    phone_upload::start_phone_upload_server(&app, &mut runtime)
}

#[tauri::command]
fn stop_phone_upload_server(
    upload_state: tauri::State<'_, SharedPhoneUploadState>,
) -> Result<(), String> {
    let mut runtime = upload_state.lock().map_err(|e| e.to_string())?;
    phone_upload::stop_phone_upload_server(&mut runtime);
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(Arc::new(Mutex::new(BakeProcessState::default())))
        .manage(Arc::new(Mutex::new(ExportProcessState::default())))
        .manage(Arc::new(Mutex::new(phone_upload::PhoneUploadRuntime::default())))
        .invoke_handler(tauri::generate_handler![
            read_text_file,
            write_text_file,
            get_app_data_dir,
            open_path_in_explorer,
            get_video_duration,
            import_main_video,
            stitch_phone_clips,
            generate_hook_preview,
            start_generate_hook_preview,
            start_phone_upload_server,
            stop_phone_upload_server,
            apply_timelapse_segments,
            start_export_mp4,
            cancel_export_mp4
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}