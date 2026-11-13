# Scene navigation: final planner native rerun

This directory records the unchanged three-test native group after the final assembly preflight error-order correction. No template, runtime generator, native test or helper was edited for this rerun. The planner SHA-256 is `882e51dbfa10c2c28e58145dec335f08b8b589c124bb252f1c1734284a586ad0`.

`summary.json` and `source-guard.json` record 3/3 passing native tests, 12 actual scene visits across two windows, 16 event publications with 16 handled deliveries, 12 revoked-visit port refusals, six PNGs and one verified offline project ZIP. Both windows used XTest synthetic X11 keyboard events in isolated Xvfb with actual focus changes and an explicitly accepting GUI control. The separate controlled contract test uses scripted action/focus calls and fake port responses; it is not OS keyboard evidence.

`keyboard-flow.json` is the original generated project. `offline-delivery.json` records standard import/script-check/run phases and the same keyboard sequence after the original author/build paths were made unavailable. The authored bytes and generated file maps match. Each raw report preserves native stdout, event provenance, visit samples and PNG hashes. `navigation-project.zip` is the standard exported project.

The before/after guard includes the final planner, contract and diagnostics plus the four template/test/helper sources; all seven remain unchanged. It also verifies 78 historical GD/text files against HEAD, seven previously generated optional-layer GD files against prior evidence, and every file in the previous `native-final-2026-11-13` directory unchanged (20 files). Earlier exploratory GUI-assumption failures remain there untouched.

This is software-rendered Xvfb/llvmpipe evidence when reported, with no hardware-GPU or physical-device keyboard claim. The initial full-suite run preceded the final planner fix; the root task records the final full-suite run separately. No author format, runtime protocol, backend descriptor or generator version was increased for these ordinary behavior templates.
