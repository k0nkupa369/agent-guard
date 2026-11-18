# Agent Guard

Agent Guard checks whether a contact-form enquiry reaches a local mail server.

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

Use Node.js 22.18 or later and run `npm ci` once to install dependencies. Then run:

```sh
npm run baseline
```

The command starts a fresh contact site and SMTP server on loopback, submits a synthetic enquiry, and exits with `0` when the inbox contains the matching email. After setup, it needs no internet connection or credentials.

```sh
npm run baseline -- --simulate-no-delivery
```

This scenario delivers an older enquiry first. The next submission shows the same success response but sends no email. The command prints `BROKEN BASELINE` and exits with `1` once the 1.5-second delivery window expires. Each run discards its inbox and closes both local servers.
