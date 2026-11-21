
## Iteration 2: partner join (narrative 3)
Walked from code: Add the other adult (Settings) -> invite link -> partner opens /invite/<token> -> sets a
password and is signed in -> roster entry active.

Finding: after adding an adult the only guidance was a toast ("tap Invite next to their name"). The link
itself lived on the member profile page (Family -> person -> Send invite / Share link). Three places to
hunt in the moment that matters.

Changed: right after adding an adult, a card "Sam is on the list" with one button, "Send Sam the link". It
makes the link and opens the phone's share sheet (copy if there is none). Cancelling the sheet changes nothing.
No email address is required and no email-verify step is in the path.

Not yet walked / still open: the partner's side on a real phone (needs a deployed email-free link), the
organizer seeing "Sam has looked" after the partner confirms (the confirmation state exists; its visibility
on home is not yet reviewed), and the join-code request path (name, email, password, captcha, then waiting for
approval) which is heavier than the emailed-link path and is the one to simplify next.
