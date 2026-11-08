# Tester guide: capture, dictation, two-adult and accessibility

For people testing LifeKeel on real phones. You do not need to be technical. Your job is to try the things below the way a real person would, tell us what happened, and tell us where you got stuck. Nothing you do here is wrong: if you got stuck, that is the result we want.

**Use made-up family details only.** Do not enter real names, policy numbers, addresses, health details or photos of real documents. Use the fictional family in section 1.

## 0. Before you start

You need: a phone (iPhone or Android), the test address `[staging address]`, and two test email addresses `[tester-1 inbox]` and `[tester-2 inbox]` so you can act as two adults. A second phone is ideal; one phone works if you sign out between roles.

Please note, and send with every report: phone model, operating system version, browser (Safari, Chrome, other), whether you were on Wi-Fi or mobile data, and the time.

## 1. The fictional family

| Person | Role in the test | Email |
|---|---|---|
| Sam Test | Organizer (the person who sets things up) | `[tester-1 inbox]` |
| Alex Test | Second adult | `[tester-2 inbox]` |

Fictional vehicle: registration `AB12 CDE`, a hatchback, MOT due 9 May. Fictional policy: any provider name you make up.

## 2. Test A: say it with your phone's own keyboard microphone

LifeKeel has no voice feature of its own. To speak instead of type, use the microphone button on your phone's keyboard. Your phone turns the voice into words, not LifeKeel, and nothing is downloaded. (A voice feature that downloaded a 40 MB model was removed on 2026-11-08.)

1. Sign in as Sam. Open the family list for **Car and transport**.
2. Tap into **Tell us in one sentence**. Tap the microphone on your keyboard.
3. Say: **"MOT due 9 May on AB12 CDE, Sam's car."** Stop dictating.
4. Check the words in the box. **Write down exactly what it heard.** Fix them if needed.
5. Tap **Show me what you understood**. Check the draft: vehicle, whose, registration, MOT due date. Tap **Save to the family list** only if it is right; otherwise tap **Not right**.

Then try, and report each:
- **Different voices and accents.** Ask two or three other people to say the same sentence. Note who and what it heard.
- **Noise.** TV on, then a quiet room.
- **A sentence you make up**, for example "Tax is due 1 June and the MOT is 9 May."
- **Dates said aloud**: "ninth of May", "9/5", "next Tuesday". Which ones does the draft get right?
- **Say nothing**, or cancel. Nothing should be made.
- **Does the tip above the box read clearly?** It should say your phone does this and not LifeKeel, and make no promise about privacy.
- **Which phone and keyboard** you used (iPhone keyboard, Gboard, Samsung). Where the audio is processed depends on your phone, so note it if your phone tells you.

What we want to know: did it work, how accurate was it, did anything feel unsafe or unclear, did you ever not know what to do.

## 3. Test B: type one sentence (no voice)

On the same page, type into **Tell us in one sentence**. Try these and say whether the draft was right:

| You type | Expect |
|---|---|
| MOT due 9 May on AB12 CDE, Sam's car | Vehicle, whose: Sam, registration AB12 CDE, MOT due 9 May |
| Tax due 1 June and MOT due 9 May | MOT due 9 May and tax due 1 June, each on the right line |
| MOT due 31 February | A message that it could not read a date |
| hello there how are you today | "We could not read that", with the form offered |
| MOT due 9 May and my cousin likes jazz | The MOT date, and "We did not use: ... cousin likes jazz" |

Also try your own natural sentences. **Write down any sentence it got wrong or did not understand.** We learn most from those.

## 4. Test C: photograph a letter or policy

On the family list page, tap **Photograph a letter or policy**. It opens the upload page. Take a photo of any made-up page of text (print a sample, or use the test letter we send you), or choose a file. Report: was it clear what happens next, did anything get added to the family list without you confirming it (it should not), how long did it take.

## 5. Test D: two adults

1. As **Sam**, open **Settings** and find your family members. You should see a switch for Alex that says **Can only view**. Turn it on: it should read **Can edit the family list**.
2. As **Alex** (second phone, or sign out and in), open the family list. Add a vehicle. It should work.
3. As Sam, switch Alex back to **Can only view**. As Alex, reload. You should see a note saying the account cannot add or remove, and the add buttons should be gone.
4. Both adults: tap **I have seen this** on a list. The page should show who is still to confirm. Change a record as one adult; the other should be asked to confirm again.
5. Try **removing a record**. It should ask first and offer **Keep it**.

Report anything confusing about who can do what and why.

## 6. Test E: the second adult joins

1. As Sam, find the invite link. As Alex (new browser or private window), open it and ask to join.
2. Read the **waiting** screen. Is it clear what happens next and for how long?
3. As Sam, approve the request in Settings (the **Approve** button). Did you know where to look?
4. As Alex, check the inbox: is there an email? Is it clear what to do? Does the link work? Can Alex sign in?

Report where you would have given up.

## 7. Test F: accessibility and comfort

Do the parts that apply to you. If you use VoiceOver (iPhone) or TalkBack (Android), a screen magnifier, large text, dark mode or a keyboard, please use them.

- **Screen reader:** can you find the main heading, the list of who is covered, the confirm button and the add form? Is anything announced badly or not at all? Is the table of who is covered understandable?
- **Large text:** set the phone's text size to the largest. Does anything get cut off or overlap?
- **Dark mode:** is every piece of text readable, including the small grey disclaimer at the bottom?
- **Tapping:** is there any button that is hard to hit?
- **Reading:** is there any word or sentence you do not understand? Copy it into your report.

## 8. How to report

One message per finding. Use this shape:

```
What I was trying to do:
What I did (steps):
What I expected:
What happened instead:
Phone / OS / browser:
How bad was it?  (1 = small annoyance, 2 = slowed me down, 3 = I could not continue, 4 = I felt unsafe or worried)
Screenshot or screen recording (no real personal details):
```

At the end, please also answer: **What was the easiest part? What was the most frustrating part? Would you use this? Why or why not?**

## 9. Things we already know (no need to report)

- LifeKeel has no voice feature of its own; dictation is your phone keyboard's. The microphone is denied for the whole site, on purpose.
- The speech model is small and English only; it will mishear some words.
- There is no "share to LifeKeel" from the phone, and no "forward an email" yet.
- Joined adults are read-only until the organizer switches editing on.
- A person who joins with someone else's email address is not blocked from setting a password; the owner has not yet chosen the fix.
- The test inboxes may take a minute to receive email.

## 10. Safety and stopping

You can stop at any time without giving a reason. If anything in the app shows you something that looks like a real person's private information, or you feel uncomfortable, stop and tell us straight away. Do not take photos of real documents. Nothing here is advice about money or insurance; it only lists what was typed in.

---

*For the study team:* findings go into the severity scale in `usability-test-kit-2026-11-07.md` (severity 3 and 4 become a fix PR within the day; 2 are batched; 1 are logged). Placeholders in square brackets need filling before this is sent. This guide has had no legal review.
