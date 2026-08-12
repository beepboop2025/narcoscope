# ScamShield private analyst import

This job validates ScamShield's privacy-minimized Telegram monitoring aggregate
and stores a NarcoScope-specific private signal under
`/var/lib/narcoscope-analyst/scamshield/`. It runs every five minutes, records a
SHA-256 receipt only when the input changes, and keeps one latest snapshot per
UTC hour.

The importer rejects raw-message flags, exact IOCs, source identifiers,
universal-coverage claims, public-eligibility claims, unknown fields, invalid
counts, and payloads that do not preserve human review. Its service has no
network access. Private state is outside the Git checkout and is never staged by
the public collector.

Install after the merged code is present at `/opt/narcoscope`:

```bash
sudo bash /opt/narcoscope/deploy/private-import/install.sh
systemctl list-timers narcoscope-scamshield-import.timer
sudo -u narcoscope-analyst test -s /var/lib/narcoscope-analyst/scamshield/current.json
```

The dedicated `intelligence-review` group can read only ScamShield's aggregate
handoff. It is deliberately separate from `scamshield-runtime`, which can read
Telegram credentials and the Telethon session.
