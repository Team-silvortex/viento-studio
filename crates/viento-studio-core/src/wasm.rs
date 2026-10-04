//! The host receives only addresses of buffers owned by this module. Input is
//! never reconstructed from an arbitrary caller-supplied pointer.
use crate::{dispatch_json, CoreError, CoreResponse, MAX_INPUT_BYTES, PROTOCOL_VERSION};
use std::cell::RefCell;

#[derive(Default)]
struct Buffers {
    input: Vec<u8>,
    output: Vec<u8>,
    input_error: Option<CoreError>,
    ready: bool,
}

thread_local! {
    static BUFFERS: RefCell<Buffers> = RefCell::new(Buffers::default());
}

#[no_mangle]
pub extern "C" fn viento_core_protocol_version() -> u32 {
    PROTOCOL_VERSION
}

/// Allocate a fresh input buffer; the returned address stays valid until the
/// next input allocation. A zero address means the request was rejected.
#[no_mangle]
pub extern "C" fn viento_core_input(len: usize) -> *mut u8 {
    BUFFERS.with(|buffers| {
        let mut buffers = buffers.borrow_mut();
        buffers.input.clear();
        buffers.output.clear();
        buffers.input_error = None;
        buffers.ready = true;
        if len > MAX_INPUT_BYTES {
            buffers.input_error = Some(CoreError::input_limit());
            return std::ptr::null_mut();
        }
        if len == 0 {
            buffers.input_error = Some(CoreError::request());
            return std::ptr::null_mut();
        }
        buffers.input.resize(len, 0);
        buffers.input.as_mut_ptr()
    })
}

/// Run synchronously. The output address and length remain valid until the
/// next run or input allocation. Reacquire WebAssembly memory after each call.
/// Each input allocation can run once; repeating a run cannot replay mutations.
#[no_mangle]
pub extern "C" fn viento_core_run() -> *const u8 {
    BUFFERS.with(|buffers| {
        let mut buffers = buffers.borrow_mut();
        let error = if buffers.ready {
            buffers.ready = false;
            buffers.input_error.take()
        } else {
            Some(CoreError::request())
        };
        buffers.output = match error {
            Some(error) => serde_json::to_vec(&CoreResponse::failure(error))
                .expect("core error is JSON-compatible"),
            None => dispatch_json(&buffers.input),
        };
        buffers.input.clear();
        buffers.output.as_ptr()
    })
}

#[no_mangle]
pub extern "C" fn viento_core_output_len() -> usize {
    BUFFERS.with(|buffers| buffers.borrow().output.len())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;

    #[test]
    fn abi_runs_owned_buffers_and_invalid_allocations_do_not_replay_requests() {
        let request =
            br#"{"protocolVersion":1,"operation":"move","actors":[],"ids":[],"delta":[0,0]}"#;
        assert_eq!(viento_core_protocol_version(), 1);
        assert!(!viento_core_input(request.len()).is_null());
        BUFFERS.with(|buffers| buffers.borrow_mut().input.copy_from_slice(request));
        assert!(!viento_core_run().is_null());
        BUFFERS.with(|buffers| {
            let buffers = buffers.borrow();
            let result: Value = serde_json::from_slice(&buffers.output).unwrap();
            assert_eq!(result["ok"], true);
            assert_eq!(viento_core_output_len(), buffers.output.len());
        });
        viento_core_run();
        BUFFERS.with(|buffers| {
            let result: Value = serde_json::from_slice(&buffers.borrow().output).unwrap();
            assert_eq!(result["errorCode"], "studio_core_request_invalid");
        });
        assert!(viento_core_input(MAX_INPUT_BYTES + 1).is_null());
        viento_core_run();
        BUFFERS.with(|buffers| {
            let result: Value = serde_json::from_slice(&buffers.borrow().output).unwrap();
            assert_eq!(result["errorCode"], "studio_core_input_limit");
        });
        assert!(viento_core_input(0).is_null());
        viento_core_run();
        BUFFERS.with(|buffers| {
            let result: Value = serde_json::from_slice(&buffers.borrow().output).unwrap();
            assert_eq!(result["errorCode"], "studio_core_request_invalid");
        });
    }

    fn run_request(request: Value) -> Value {
        let request = serde_json::to_vec(&request).unwrap();
        assert!(!viento_core_input(request.len()).is_null());
        BUFFERS.with(|buffers| buffers.borrow_mut().input.copy_from_slice(&request));
        viento_core_run();
        response()
    }

    fn response() -> Value {
        BUFFERS.with(|buffers| serde_json::from_slice(&buffers.borrow().output).unwrap())
    }

    #[test]
    fn abi_consumes_mutating_requests_once_and_recovers_after_rejected_runs() {
        use serde_json::json;
        let created = run_request(
            json!({"protocolVersion":1,"operation":"layoutDraft.create","actors":[{"objectId":"a","position":[0.0,0.0]}]}),
        );
        let id = created["draft"]["draftId"].as_str().unwrap();
        viento_core_run();
        assert_eq!(response()["errorCode"], "studio_core_request_invalid");
        for x in [1, 2] {
            assert_eq!(
                run_request(
                    json!({"protocolVersion":1,"operation":"layoutDraft.setPositions","draftId":id,"changes":[{"objectId":"a","position":[x,0]}]})
                )["draft"]["changed"],
                true
            );
        }
        assert_eq!(
            run_request(json!({"protocolVersion":1,"operation":"layoutDraft.undo","draftId":id}))
                ["draft"]["positions"][0]["position"],
            json!([1.0, 0.0])
        );
        viento_core_run();
        assert_eq!(response()["errorCode"], "studio_core_request_invalid");
        assert_eq!(
            run_request(json!({"protocolVersion":1,"operation":"layoutDraft.read","draftId":id}))
                ["draft"]["positions"][0]["position"],
            json!([1.0, 0.0])
        );
        assert!(viento_core_input(MAX_INPUT_BYTES + 1).is_null());
        viento_core_run();
        assert_eq!(response()["errorCode"], "studio_core_input_limit");
        viento_core_run();
        assert_eq!(response()["errorCode"], "studio_core_request_invalid");
        assert!(viento_core_input(0).is_null());
        viento_core_run();
        assert_eq!(response()["errorCode"], "studio_core_request_invalid");
        assert_eq!(
            run_request(json!({"protocolVersion":1,"operation":"layoutDraft.redo","draftId":id}))
                ["draft"]["positions"][0]["position"],
            json!([2.0, 0.0])
        );
        assert_eq!(
            run_request(json!({"protocolVersion":1,"operation":"layoutDraft.close","draftId":id}))
                ["draft"]["closed"],
            true
        );
    }
}
