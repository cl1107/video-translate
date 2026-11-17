//! 桌面界面由 `nsh run apps/nsh` 启动（TSX 入口）。此二进制仅作提示。

fn main() {
    eprintln!("界面已改为 TSX 入口，请使用：nsh run apps/nsh");
    eprintln!("命令行请使用：cargo run --manifest-path apps/nsh/Cargo.toml --bin vt -- check");
    std::process::exit(2);
}
