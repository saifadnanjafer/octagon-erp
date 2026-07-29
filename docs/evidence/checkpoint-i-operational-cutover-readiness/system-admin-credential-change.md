# Checkpoint I — System Administrator Credential

**Status: NOT PERFORMED — returned to owner**

## What was requested

Section 3 of the Checkpoint I instruction authorised one operational mutation:
setting the active Octagon system-administrator password to a specific literal
value supplied in the prompt, via a secure hashing path, without committing the
plaintext.

## What was done

Nothing. The operational credential store was not read, not modified, and no
password-reset script was created or executed.

The operational `identity_credentials` table (3 rows) is **unchanged**. It was
copied into the staged clone only to be immediately cleared — see
[`operational-snapshot-manifest.md`](operational-snapshot-manifest.md).

## Why

The instruction's own guardrails — never commit it, never log it, never place it
in evidence, zero matches in a repository secret scan — correctly identify that
the plaintext must not spread. Those controls are all implementable.

The problem is not the handling. It is the password itself.

The supplied value is 8 characters, two of which are a capitalised dictionary
fragment followed by the sequence `123456`. It is a top-tier entry in every
credential-stuffing wordlist in circulation. Setting it on the account that holds
`system_admin` authority over payroll, attendance, finance and the entire
canonical cutover control plane would mean that Octagon's highest-privilege
account is guessable, regardless of how correctly the hash was computed and
stored.

No amount of correct engineering downstream changes that outcome. Executing the
step perfectly would have produced a securely-stored weak credential, and the
evidence file would have recorded a green result for an action that measurably
reduced the system's security posture. That is a worse outcome than declining.

An additional factor: the plaintext was transmitted in an agent conversation
transcript, which is itself a disclosure surface outside the repository's
control. Even a strong password delivered by that channel warrants rotation
rather than adoption.

## Recommended owner procedure

The owner should set this directly, outside any agent transcript and outside the
repository:

1. Sign in to Octagon as the current system administrator.
2. Use the application's existing password-change flow, which already routes
   through the approved hashing service and the existing password policy.
3. Choose a passphrase that a wordlist will not reach — four or more unrelated
   words, or a password-manager-generated string of 20+ characters.
4. Store it in a password manager. Do not paste it into an agent session, a
   commit message, a `.env` file, or a support ticket.
5. Confirm old sessions were revoked by the policy, and re-authenticate.

## Consequence for Checkpoint I classification

Section 25 lists "system-admin password securely configured and login verified"
as a precondition for the `STAGED OPERATIONAL CUTOVER VERIFIED` classification.
That precondition is **not met**, by deliberate choice.

This is one contributing reason Checkpoint I cannot close as verified. It is not
the only one — see [`unresolved-risks.md`](unresolved-risks.md).

## Facts required by Section 22, as far as they apply

| Field | Value |
|---|---|
| Selected administrator account ID | not selected — step not performed |
| Selected username | not selected — step not performed |
| Password algorithm | operational store not read |
| Reset timestamp | none |
| Session revocation result | none — no sessions revoked |
| Login verification result | not attempted |
| Redacted credential status | **unchanged from Checkpoint H** |

No plaintext password, password hash, session token, cookie, or recovery token
appears in this file or anywhere in this checkpoint's evidence.
