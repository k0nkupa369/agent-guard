# Agent Guard

Agent Guard checks whether a contact-form enquiry reaches a local mail server.

## Run the local demo

Use Node.js 22.18 or later and run `npm ci` once to install dependencies. Then run:

```sh
npm run demo
```

The default demo verifies the original form, applies a bundled edit that confirms enquiries without sending mail, and restores the original form. Recovery is verified when a new enquiry reaches the local inbox. The guard keeps an accepted edit for the current run.

| Command | Outcome | Exit |
| --- | --- | --- |
| `npm run demo` | Edit rejected, recovery verified | 2 |
| `npm run --silent demo -- --scenario valid` | Edit accepted | 0 |
| `npm run --silent demo -- --scenario broken-baseline` | Baseline broken, proposal left unapplied | 1 |
| `npm run --silent demo -- --scenario failed-recovery` | Edit rejected, recovery failed | 3 |

The terminal progress and verdict go to stderr. Use `npm run --silent demo` to pipe the JSON report from stdout. The report includes each check's reference, rendered form result, confirmation, and matching email or failure. Exit status 4 identifies an invalid proposal.

## Webhook retries

```sh
npm run --silent webhook
```

The proposed edit adds a second webhook event type. The guard sends event A, retries A, and sends a distinct event B for the same lead. All requests return HTTP 204, but the bundled edit writes three ledger entries where two are expected. The guard restores the original definition and verifies it with fresh events. The default exits with status `2`.

Use `-- --scenario valid` to keep the edit or `-- --scenario suppress-distinct` to see a definition that loses B instead. The JSON report includes the acknowledgements and expected and observed event IDs. [Recorded webhook run](docs/webhook-run.json)

## Evaluate a live proposal

Set `OPENAI_API_KEY` in your shell environment, then run:

```sh
npm run --silent demo -- --live
```

After verifying baseline delivery, Agent Guard sends the synthetic task and form definition to OpenAI in one request to GPT-6 Luna. The request uses your API account. The guard reports the first outcome and runs the same local delivery and recovery checks for a valid proposal. Provider or credential errors exit with status 5. The JSON report identifies the model and includes the proposal when it passes form-definition validation.

Run `npm run check:cli` to check the contact and webhook demos, both baseline commands, and the live path with a provider stub. CI runs the same checks without an API key.

## Recorded live walkthrough

On 19 November 2026 (Pacific/Auckland), one OpenAI Responses API run used the configured model `gpt-6-luna`. The task was to add an optional Company field and append Company to the email fields.

The proposal kept the original fields and email order. It appended `{"name":"company","required":false}` to the form fields and `"company"` to the email fields.

| Submission | Reference | Local inbox evidence |
| --- | --- | --- |
| Original form | `bca2f805-581d-454c-b937-d35ce03583a1` | Matching enquiry email received |
| Edited form with Company | `b1a89aa4-e237-41c7-bde6-0b268cfab400` | Matching email included `Company: Example Studio` |
| Edited form without Company | `79d240f8-dc61-47fc-b0a5-8a04c7af850b` | Matching email had no Company line |

All three rendered form and submission checks passed. The guard kept this proposal for the run and reported **EDIT ACCEPTED** with exit status `0`. [Read the recorded JSON report](docs/live-run.json).

The offline quickstart was also verified from a clean copy on Node.js 22.23.1. The edited form confirmed both submissions without sending mail. After restoration, a fresh matching email arrived and `npm run demo` reported **EDIT REJECTED — RECOVERY VERIFIED** with exit status `2`.

## Verify baseline delivery

```sh
npm run baseline
```

The command starts a fresh contact site and SMTP server on loopback, submits a synthetic enquiry, and exits with `0` when the inbox contains the matching email. After setup, it needs no internet connection or credentials.

```sh
npm run baseline -- --simulate-no-delivery
```

This scenario delivers an older enquiry first. The next submission shows the same success response but sends no email. The command prints `BROKEN BASELINE` and exits with `1` once the 1.5-second delivery window expires. Each run discards its inbox and closes both local servers.
