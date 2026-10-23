//! Explicit first-match event branches. The legacy table and conditional-table
//! operations remain unambiguous; this separate capability preserves row order.
#![forbid(unsafe_code)]
use crate::{animation_state_conditions, animation_state_table, CoreError};
use serde_json::{json, Value};
use std::collections::HashSet;

fn invalid() -> CoreError {
    CoreError { error_code: "animation_state_table_invalid", message: "Expected explicit first-match event branches with a final optional fallback per state and event." }
}
fn exact(value: &Value, keys: &[&str]) -> bool {
    value.as_object().is_some_and(|record| {
        record.len() == keys.len() && keys.iter().all(|key| record.contains_key(*key))
    })
}
pub(crate) fn dispatch_table(
    request: &Value,
) -> Result<animation_state_table::AnimationStateTableResponse, CoreError> {
    if !exact(request, &["protocolVersion", "operation", "table"])
        || request["protocolVersion"].as_u64() != Some(1)
        || request["operation"] != "animationStateTable.inspectBranches"
    {
        return Err(CoreError::request());
    }
    let table = &request["table"];
    if !exact(
        table,
        &["initialState", "states", "transitions", "eventSelection"],
    ) || table["eventSelection"] != "firstMatch"
        || animation_state_conditions::declaration_bytes(table)? > 32768
    {
        return Err(invalid());
    }
    let transitions = table["transitions"].as_array().ok_or_else(invalid)?;
    if transitions.len() > 64 {
        return Err(invalid());
    }
    let mut plain =
        json!({"initialState":table["initialState"],"states":table["states"],"transitions":[]});
    let mut result = animation_state_table::inspect(&plain)?;
    let mut normalized = table.clone();
    let mut seen_events = HashSet::new();
    let mut completed = HashSet::new();
    let mut closed = HashSet::new();
    for (index, transition) in transitions.iter().enumerate() {
        let mut edge = transition.clone();
        let condition = edge
            .get_mut("trigger")
            .and_then(Value::as_object_mut)
            .and_then(|trigger| trigger.remove("condition"));
        let condition = match condition {
            Some(condition) => {
                if edge["trigger"]["kind"] != "event" {
                    return Err(invalid());
                }
                Some(animation_state_conditions::inspect(&condition).map_err(|_| invalid())?)
            }
            None => None,
        };
        // Reuse the exact legacy edge/name/reference validator without relaxing
        // its uniqueness rules. At most 64 bounded single-edge inspections occur.
        plain["transitions"] = json!([edge]);
        let mut inspected = animation_state_table::inspect(&plain)?;
        let from = transition["from"].as_str().ok_or_else(invalid)?;
        let trigger = &transition["trigger"];
        if trigger["kind"] == "completed" {
            if !completed.insert(from.to_owned()) {
                return Err(invalid());
            }
        } else {
            let name = trigger["name"].as_str().ok_or_else(invalid)?;
            let signature = (from.to_owned(), name.to_owned());
            if closed.contains(&signature) {
                return Err(invalid());
            }
            if condition.is_none() {
                closed.insert(signature);
            }
            if seen_events.insert(name.to_owned()) {
                if seen_events.len() > 32 {
                    return Err(invalid());
                }
                result.event_names.push(name.to_owned());
            }
        }
        let mut indexed = inspected.transitions.remove(0);
        if let Some(condition) = condition {
            indexed.trigger["condition"] = condition.clone();
            normalized["transitions"][index]["trigger"]["condition"] = condition;
        }
        result.transitions.push(indexed);
    }
    result.table = normalized;
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn table() -> Value {
        json!({"initialState":"idle","eventSelection":"firstMatch","states":[{"key":"idle"},{"key":"fast"},{"key":"slow"}],"transitions":[
            {"from":"idle","to":"fast","trigger":{"kind":"event","name":"move","condition":{"type":"number","operator":"gte","value":0.8}}},
            {"from":"fast","to":"idle","trigger":{"kind":"completed"}},
            {"from":"idle","to":"slow","trigger":{"kind":"event","name":"move","condition":{"type":"number","operator":"gte","value":0.2}}},
            {"from":"idle","to":"idle","trigger":{"kind":"event","name":"move"}}
        ]})
    }
    fn run(value: Value, operation: &str) -> Value {
        serde_json::to_value(crate::dispatch(
            &serde_json::to_vec(&json!({"protocolVersion":1,"operation":operation,"table":value}))
                .unwrap(),
        ))
        .unwrap()
    }
    fn inspect(value: Value) -> Value {
        run(value, "animationStateTable.inspectBranches")
    }
    #[test]
    fn explicit_branches_preserve_full_order_indices_and_mode() {
        let source = table();
        let response = inspect(source.clone());
        assert_eq!(response["ok"], true);
        let result = &response["animationStateTable"];
        assert_eq!(result["table"], source);
        assert_eq!(result["eventNames"], json!(["move"]));
        assert_eq!(result["transitions"][0]["toIndex"], 1);
        assert_eq!(result["transitions"][1]["fromIndex"], 1);
        assert_eq!(result["transitions"][2]["toIndex"], 2);
        assert_eq!(result["transitions"][3]["toIndex"], 0);
        assert_eq!(crate::viento_core_animation_state_branches_version(), 1);
        assert_eq!(crate::viento_core_animation_state_conditions_version(), 1);
        assert_eq!(crate::viento_core_animation_state_table_version(), 1);
    }
    #[test]
    fn old_operations_keep_rejecting_mode_and_duplicate_event_triggers() {
        for op in [
            "animationStateTable.inspect",
            "animationStateTable.inspectConditional",
        ] {
            assert_eq!(
                run(table(), op)["errorCode"],
                "animation_state_table_invalid"
            );
            let mut source = table();
            source.as_object_mut().unwrap().remove("eventSelection");
            assert_eq!(
                run(source, op)["errorCode"],
                "animation_state_table_invalid"
            );
        }
    }
    #[test]
    fn opt_in_is_required_even_for_empty_or_unambiguous_tables() {
        for transitions in [
            json!([]),
            json!([table()["transitions"][3]]),
            json!([table()["transitions"][0]]),
        ] {
            let mut source = table();
            source["transitions"] = transitions;
            assert_eq!(
                inspect(source.clone())["animationStateTable"]["table"],
                source
            );
            source.as_object_mut().unwrap().remove("eventSelection");
            assert_eq!(
                inspect(source)["errorCode"],
                "animation_state_table_invalid"
            );
        }
        for mode in [
            Value::Null,
            json!(false),
            json!("ordered"),
            json!({"firstMatch":true}),
        ] {
            let mut source = table();
            source["eventSelection"] = mode;
            assert_eq!(
                inspect(source)["errorCode"],
                "animation_state_table_invalid"
            );
        }
    }
    #[test]
    fn fallback_is_final_within_its_group_and_completions_stay_unique() {
        let mut source = table();
        source["transitions"].as_array_mut().unwrap().swap(0, 3);
        assert_eq!(
            inspect(source)["errorCode"],
            "animation_state_table_invalid"
        );
        let mut source = table();
        let fallback = source["transitions"][3].clone();
        source["transitions"].as_array_mut().unwrap().push(fallback);
        assert_eq!(
            inspect(source)["errorCode"],
            "animation_state_table_invalid"
        );
        let mut source = table();
        let completion = source["transitions"][1].clone();
        source["transitions"]
            .as_array_mut()
            .unwrap()
            .push(completion);
        assert_eq!(
            inspect(source)["errorCode"],
            "animation_state_table_invalid"
        );
        let mut source = table();
        source["transitions"][1]["trigger"]["condition"] =
            json!({"type":"boolean","operator":"eq","value":true});
        assert_eq!(
            inspect(source)["errorCode"],
            "animation_state_table_invalid"
        );
        let mut source = table();
        source["transitions"][1]["trigger"] = json!({"kind":"event","name":"move"});
        assert_eq!(
            inspect(source)["ok"],
            true,
            "same event in a different state is independent"
        );
    }
    #[test]
    fn every_edge_is_validated_and_ordered_predicate_overlap_is_allowed() {
        let mut source = table();
        source["transitions"][2]["trigger"]["condition"] =
            source["transitions"][0]["trigger"]["condition"].clone();
        assert_eq!(inspect(source.clone())["ok"], true);
        source["transitions"][2]["to"] = json!("missing");
        assert_eq!(
            inspect(source)["errorCode"],
            "animation_state_table_invalid"
        );
        let mut source = table();
        source["transitions"][2]["trigger"]["extra"] = json!(true);
        assert_eq!(
            inspect(source)["errorCode"],
            "animation_state_table_invalid"
        );
        let mut source = table();
        source["transitions"][2]["trigger"]["condition"] = Value::Null;
        assert_eq!(
            inspect(source)["errorCode"],
            "animation_state_table_invalid"
        );
    }
    #[test]
    fn count_bounds_include_all_branches_and_unique_event_names() {
        let mut source = table();
        source["transitions"] = json!(vec![source["transitions"][0].clone(); 64]);
        assert_eq!(inspect(source.clone())["ok"], true);
        let edge = source["transitions"][0].clone();
        source["transitions"].as_array_mut().unwrap().push(edge);
        assert_eq!(
            inspect(source)["errorCode"],
            "animation_state_table_invalid"
        );
        let mut source = table();
        source["transitions"] = json!((0..32).map(|index| json!({"from":"idle","to":"idle","trigger":{"kind":"event","name":format!("e{index}")}})).collect::<Vec<_>>());
        assert_eq!(inspect(source.clone())["ok"], true);
        source["transitions"]
            .as_array_mut()
            .unwrap()
            .push(json!({"from":"idle","to":"idle","trigger":{"kind":"event","name":"extra"}}));
        assert_eq!(
            inspect(source)["errorCode"],
            "animation_state_table_invalid"
        );
    }
    #[test]
    fn duplicate_raw_keys_remain_rejected_before_branch_dispatch() {
        let input = serde_json::to_string(&json!({"protocolVersion":1,"operation":"animationStateTable.inspectBranches","table":table()})).unwrap();
        let duplicate = input.replace(
            "\"eventSelection\":",
            "\"eventSelection\":null,\"eventSelec\\u0074ion\":",
        );
        let response = serde_json::to_value(crate::dispatch(duplicate.as_bytes())).unwrap();
        assert_eq!(response["errorCode"], "studio_core_request_invalid");
    }
}
