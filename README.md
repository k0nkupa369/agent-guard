# Agent Guard

Agent Guard checks whether a contact-form enquiry reaches a local mail server.

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
