#[allow(dead_code)]
#[path = "/home/chiharukiryu/cdev/viento-studio/src-tauri/src/workspace.rs"]
mod workspace;
fn main() {
    let args: Vec<String> = std::env::args().collect();
    assert_eq!(args.len(), 3);
    match workspace::import_workspace(std::path::Path::new(&args[1]), std::path::Path::new(&args[2])) {
        Ok(root) => println!("{}", serde_json::json!({"restoredRoot": root})),
        Err(message) => { eprintln!("{}", message); std::process::exit(1); }
    }
}
