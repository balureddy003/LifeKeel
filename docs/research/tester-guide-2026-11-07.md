# Tester guide: voice, capture, two-adult and accessibility

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

## 2. Test A: say it (voice) on your phone

This is the new feature and the one we most need real phones for. It is **off unless you switch it on for your own phone**.

1. Sign in as Sam. Open the family list for **Car and transport**.
2. Add `?voice=on` to the end of the page address, for example `.../domains/?d=car&voice=on`, and press go. A **Say it** button should appear above the sentence box. (To turn it off later, use `?voice=off`.)
3. Tap **Say it**. Read what the box tells you. It should say your voice is turned into words **on this phone and never leaves it**, that a small speech model (about 40 MB) downloads once, and that the download carries nothing you say.
   - Is that clear? Would you be happy to agree? Say if anything worried you.
4. Tap **Download and start**. Your phone will ask to use the microphone. Allow it.
5. Say: **"MOT due 9 May on AB12 CDE, Sam's car."** Tap **Stop**.
6. Wait. The first time can take a minute while the model downloads. **Write down how long you waited.**
7. Check the words that appear in the box. **Write down exactly what it heard.** Fix them if needed.
8. Tap **Show me what you understood**. Check the draft: vehicle, whose, registration, MOT due date. Tap **Save to the family list** only if it is right; otherwise tap **Not right**.

Then try, and report each:
- **Different voices and accents.** Ask two or three other people (different accents, an older person, a child's voice if a parent is happy) to say the same sentence. Note who and what it heard.
- **Noise.** Say it with a TV on, then in a quiet room.
- **A sentence you make up**, for example "Tax is due 1 June and the MOT is 9 May."
- **Say nothing**, then tap Stop. What does it say?
- **Say it, but tap Cancel.** Nothing should be made.
- **Refuse the microphone** when the phone asks (or turn it off in the phone's settings). Does the message tell you what to do?
- **Airplane mode test** (proves the voice stays on the phone): after the model has downloaded once, switch on airplane mode, then use **Say it** again. It should still work. If it does not, tell us.
- **Remove the speech model** with the button at the bottom of the voice area. Does it say it was removed? Then try **Say it** again: it should ask again before downloading.

What we want to know: did it work, how accurate was it, how long did it take, did anything feel unsafe or unclear, did you ever not know what to do.

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

- Voice is off by default and has never run on a real phone before this test; some failures are expected.
- The speech model is small and English only; it will mishear some words.
- There is no "share to LifeKeel" from the phone, and no "forward an email" yet.
- Joined adults are read-only until the organizer switches editing on.
- A person who joins with someone else's email address is not blocked from setting a password; the owner has not yet chosen the fix.
- The test inboxes may take a minute to receive email.

## 10. Safety and stopping

You can stop at any time without giving a reason. If anything in the app shows you something that looks like a real person's private information, or you feel uncomfortable, stop and tell us straight away. Do not take photos of real documents. Nothing here is advice about money or insurance; it only lists what was typed in.

---

*For the study team:* findings go into the severity scale in `usability-test-kit-2026-11-07.md` (severity 3 and 4 become a fix PR within the day; 2 are batched; 1 are logged). Placeholders in square brackets need filling before this is sent. This guide has had no legal review.
