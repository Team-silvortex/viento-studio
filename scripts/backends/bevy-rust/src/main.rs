mod behavior_sources;
pub mod runtime;

fn main() -> std::process::ExitCode {
    match runtime::execute() {
        Ok(()) => std::process::ExitCode::SUCCESS,
        Err(message) => {
            eprintln!("{message}");
            std::process::ExitCode::FAILURE
        }
    }
}
