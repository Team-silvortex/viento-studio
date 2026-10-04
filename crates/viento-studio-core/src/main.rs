//! JSON-lines adapter for native conformance tests. No scene files are opened.
use std::io::{self, BufRead, Write};
use viento_studio_core::{dispatch_json, input_limit_json, MAX_INPUT_BYTES};

fn main() -> io::Result<()> {
    let mut input = io::stdin().lock();
    let mut output = io::stdout().lock();
    let mut line = Vec::new();
    let mut too_long = false;
    loop {
        let bytes = input.fill_buf()?;
        if bytes.is_empty() {
            if too_long || !line.is_empty() {
                write_response(&mut output, &line, too_long)?;
            }
            return Ok(());
        }
        let newline = bytes.iter().position(|byte| *byte == b'\n');
        let length = newline.unwrap_or(bytes.len());
        if !too_long {
            if line.len() + length > MAX_INPUT_BYTES {
                line.clear();
                too_long = true;
            } else {
                line.extend_from_slice(&bytes[..length]);
            }
        }
        input.consume(length + usize::from(newline.is_some()));
        if newline.is_some() {
            write_response(&mut output, &line, too_long)?;
            line.clear();
            too_long = false;
        }
    }
}

fn write_response(output: &mut impl Write, line: &[u8], too_long: bool) -> io::Result<()> {
    output.write_all(&if too_long {
        input_limit_json()
    } else {
        dispatch_json(line)
    })?;
    output.write_all(b"\n")?;
    output.flush()
}
