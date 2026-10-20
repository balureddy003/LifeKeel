# Runbook: connect a network and publish the first post

For a person with operator access. Accounts are created by a person first (see
[the social presence kit](../marketing/social-presence-kit.md)); this runbook starts once a profile exists.
Start with **Bluesky**: it needs only a handle and an app password. Do not paste an account password anywhere.

## Before you start

- The profile exists, with the picture, banner, bio and link from the kit.
- You can sign in to the operator console with the `marketing.manage` permission.
- **Settings > Automation:** dry-run mode is on for this first pass (it rehearses the whole flow without a
  network call). Turn it off only at step 6.
- **Operator > Configuration:** `marketing_paused` is off. This switch halts every publish and send; it is
  your emergency stop.

## 1. Create an app password on the network

Bluesky: Settings > Privacy and security > App passwords > add one named `lifekeel-console`. Copy it once.
Use a new one for this purpose so it can be revoked without touching anything else.

## 2. Connect it in the console

Operator > Marketing > Channels > Bluesky: enter the handle (for example `lifekeel.co.uk`) and the app
password. The console checks them with the network and stores the password encrypted. The channel then shows the
account that would publish.

## 3. Draft the first post

Take post 1 from section 6 of the kit. In the composer, pick Bluesky, paste it, add the UTM link from the kit,
and save the draft. The queue shows a **copy guard** result. If it lists violations the post cannot be
approved: edit the wording and save again until it passes.

## 4. Rehearse (dry run)

Approve the draft. With dry-run on, the post is marked published and tagged "dry run", with no call to the
network. Confirm the state, the audit entry and the link.

## 5. Check the details by eye

Open the link: it should land on the site with the `utm_source`, `utm_medium=social` and `utm_content` you set.
Read the post once more as a stranger would. Nothing in it should be an instruction to buy, switch or compare,
or name a provider.

## 6. Publish for real

Turn dry-run off, draft the post again (or retry), approve it. Open the profile on the network and check:
the text, the link preview, and that it posted as the right account. Record the date in the launch checklist.

## If something goes wrong

| Symptom | What it means | What to do |
|---|---|---|
| `copy_guard_failed` | The text breaks a rule; it was not sent | Edit and approve again. If the rule looks wrong, raise it, do not bypass it |
| `publish_failed` with an auth error | The app password was revoked or mistyped | Create a new one and reconnect (step 1 and 2), then retry |
| `publish_failed`, `channel_not_configured` | The network is not connected | Connect it |
| Posted something you did not want | Approvals are the only way out the door, so find the approver in the audit log | Delete it on the network by hand, then reject related drafts |
| Anything alarming | | Set `marketing_paused` in Operator > Configuration. Everything stops |

## Other networks, later

- **LinkedIn:** the connection token lasts about 60 days and does not refresh. Put the renewal date in a calendar;
  after that, publishes fail until you reconnect.
- **Instagram:** needs an image. The post cards in `docs/marketing/social-assets/` must be hosted at a public
  address first (for example under `apps/web/public/social/` and deployed), then the address goes in the post's
  media field.
- **X, Facebook, Threads:** connect through their buttons in the console; each needs its own app review on the
  network's side, which can take days.

## After the first week

Check Operator > Marketing > Performance: views and signups by `utm_source`. Keep what earned replies.
