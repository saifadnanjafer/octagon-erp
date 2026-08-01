# Supported Safety Policies

The permanent, versioned policy is `AGENTS.md` plus the controller preflight.
It is enforced independently of any provider configuration.

- Gemini is not installed, so no Gemini command, policy file, or resume flag is
  shipped or claimed.
- Codex was present but not callable from this shell during reconciliation; no
  Codex CLI invocation is embedded.
- Claude and Kimi advertised plan-mode flags in their local `--help` output.
  The runner may launch only those plan modes, never their auto-approval or
  bypass-permission modes.

Local provider configuration can change outside this repository. Any future
provider-specific safety policy must be validated against that installed CLI's
own help and documented configuration before use.
