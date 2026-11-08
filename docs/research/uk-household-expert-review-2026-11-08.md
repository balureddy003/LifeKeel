# Expert-lens review of the UK household scenarios

Date: 2026-11-08. Five reviewers each read the 22 households in
`uk-household-coverage-2026-11-08.md` (expected outcomes only, not the code) from one
expert point of view and proposed what was missing.

**What these reviewers are.** Simulated expert perspectives produced by AI agents. They are
useful for finding gaps. They are **not** credentialed people and **not** sign-off. The
family-law, safeguarding and data-protection points still need a qualified human review
before launch, and nation-specific wording (England, Wales, Scotland, Northern Ireland)
needs legal input.

## What became scripts (households H23 to H40)

| ID | From | Scenario | What the family should experience (summary) |
|---|---|---|---|
| H23 | Family law S4 | Leaving a family yourself | An adult can leave without the organizer; an organizer can hand over and then leave |
| H24 | Family law S2, S8; Privacy V4 | Removed without a word | A removed person gets no email at all about the removal or later changes |
| H25 | Family law S1 | Handover under pressure | Someone made organizer cannot lock out the person who made them one [DECISION] |
| H26 | Family law (S6) | Turned down, then keeps asking | After a decline, the same person cannot keep re-requesting [DECISION] |
| H27 | Protection P2; Demographics D2, D3 | Records stay when someone leaves or dies | Records held by a removed person stay, shown as held by someone no longer in the family |
| H28 | Demographics D1 | A child in two homes | The child can be on two lists; neither parent sees the other's list |
| H29 | Demographics D5 | A lodger in the house | A lodger is not shown the family's private records [DECISION] |
| H30 | Demographics D6 | One name, and a name that changes | A single name is accepted; a rename shows once on the family list |
| H31 | Demographics D7; Protection P5 | Just arrived, nearly empty list | A non-UK country is accepted; an empty list never hints at a gap |
| H32 | Demographics D8; Protection P1 | Forces family abroad | A passed MOT date is shown as passed, never as illegal |
| H33 | Accessibility A5 | A couple sharing one mailbox | A reused email gets a plain explanation, not a code or a server error |
| H34 | Accessibility A6 | An adult with no email | Can be listed; the list says they have not seen it |
| H35 | Privacy V5 | Turning 18 this week | Asked to confirm the day after the 18th birthday, not the day before |
| H36 | Privacy V1, V3 | Everything about me, and delete the family | An adult's export holds only their own data; deleting the family kills sessions and the code |
| H37 | Privacy V7 | An invite to the wrong address | A stranger learns no child's name or list content; cancelling kills the link |
| H38 | Accessibility A8; Protection P6 | Double taps, forgotten passwords | One save leaves one entry; a reset reveals no account; codes avoid O, I, L |
| H39 | Family law (H10 challenge) | Excused is not "has seen it" | An excused person is never listed as having confirmed |
| H40 | Demographics (H17 challenge) | Handover: outgoing organizer | The person who handed over can still look after the family |

## First run on staging (image staging-8cde5fe9, before #420 and #421)

47 expectations in H23 to H40: 32 met, 15 not met on the first run. After removing three
mistakes in the script (H27 holder not yet joined, H25 second check on a dead session, and H34
which needs #420 deployed), the genuine results are:

**Working well (met):** removing a person sends them no email (H24); a child can be on two
parents' lists without leaking between them (H28); a non-UK country is accepted and an empty
list never hints at a gap (H31); a passed MOT is shown as passed and never called illegal
(H32); a reused email gets a plain explanation (H33); turning 18 is handled to the day (H35);
an adult's data export holds only their own data, and deleting the family kills sessions and
the code (H36); excused is never listed as "has seen it" (H39); records held by a removed person
stay on the list and are labelled (H27); the person who handed over keeps control (H40).

**Product findings (not met):**

| ID | Finding | Severity |
|---|---|---|
| H23 | An adult cannot leave the family on their own (only the organizer can remove people), and an organizer cannot remove themselves even after handing over | blocks a person who needs to leave; safety |
| H25 | Someone made organizer can remove the person who made them one, so a coerced handover can lock the victim out | safety [DECISION] |
| H26 | A declined requester can ask again and again | safety [DECISION] |
| H29 | A lodger or helper who joins sees everything on the family list; there is no limited view | privacy [DECISION] |
| H30 | After a person changes their name in their profile, the family list still shows the old name | confuses (bug) |
| H37 | The invite email names the family to whoever receives it, including someone it reached by mistake | privacy [DECISION] |
| H38 | The same car saved twice at once is listed twice | confuses [DECISION] |
| H34 | Needs #420 deployed: an adult with no login must not let the list read as complete | passes after deploy |



| From | Scenario | Why not an API script |
|---|---|---|
| Accessibility A1 | Blind screen-reader user joins and confirms | Needs VoiceOver or TalkBack and a real user |
| Accessibility A2 | Low literacy, dyslexia, English as an additional language | Reading and understanding; copy is only partly scriptable (grade 9 check exists) |
| Accessibility A3 | Older person, large system text, small old phone | Needs 320px width, 200 percent text, reflow in a browser |
| Accessibility A4 | Tremor or motor difficulty; accidental removal | Spacing, no drag-only actions; whether removal has an undo is a product question |
| Accessibility A7 | Carer acting for someone | Who pressed confirm is recorded or not (product question) |
| Accessibility A8 (part) | Signal drops mid-save | Needs throttled or offline browser |
| Family law S3 | The only organizer dies; nobody can approve | Needs a takeover route with proof of death: a product and legal decision |
| Family law S5 | Parent without parental responsibility; named guardian | Wording and legal status; differs by nation |
| Family law S6 | Child in care; birth parent with contact restrictions | Needs a block or contact-restriction concept; legal input |
| Family law S7 | Lasting power of attorney and a vulnerable adult | Legal status; "excused" must not be usable to silence an adult |
| Protection P3, P4, P7, P8 | Policy covers someone who turns 18; employer cover ends; non-sterling or outside nominee; edge digest months | Need policies set through the financial profile, a record end-date and currency field that may not exist; digest edge months partly covered by scenario 16 |
| Demographics D4 | Parent in a care home who cannot join | Overlaps the excuse switch; wording needs a person |
| Privacy V2 | Erasure of one member while the family stays | Needs a member-erasure flow; today removal is the nearest thing |
| Privacy V6 | One adult changes a child's birth date; the other disagrees | Needs who-changed-what history on child details |
| Privacy V8 | Joining with someone else's email | Known weakness (join does not prove the mailbox); needs an account-model decision |
| Privacy V9, V10 | Digest unsubscribe by one adult; a relative asks for a dead person's data | Product and legal decisions |

## Existing expectations the reviewers challenged

| Challenge | Reviewer | Disposition |
|---|---|---|
| H08: the join reply must not name the family, and a real and a wrong code must look the same | Family law, privacy | First half fixed (#419). Second half (a wrong code answers differently from a live one) is **not yet tested** |
| H09: naming one adult as the holdout can read as blame; prefer "waiting for one adult who has not joined" | Protection | **Wording decision for the owner** |
| H09, H10: an excused person must read as "not asked", never "has seen" | Family law, privacy | Added as H39. Settings wording to be checked |
| H07: removal must send the removed person nothing, and their name and activity should leave others' view | Family law, privacy | Mail part added (H24). Activity-history part not tested |
| H07: a clean cut-off is the safe case; real co-parents often want shared visibility | Demographics | Noted as a product gap, not a pass |
| H11: removing Tom after a death should keep his records, marked as deceased, and "first steps" must be information only and differ by nation | Family law, privacy, protection | Records kept: H27. "Marked deceased" and nation-specific steps are **decisions** |
| H15: a 17-year-old listed as an adult is treated as a child silently; she may be a young carer or at risk at home | Demographics, family law | Age rule tested (H35). Showing her why she is excluded is a **wording decision** |
| H16: the overdue date must be said in words, not only colour or position | Accessibility | Needs a browser or screen-reader check |
| H17: test that the outgoing organizer keeps access | Demographics, family law | Added as H40 |
| H20: add a slow-connection case | Accessibility | Browser tool, not scripted |
| H22: confirm a lapsed request's data is deleted, not hidden | Privacy | Needs a database check; not scripted |
| H03/H11: "seen by every adult" is vacuous for a one-adult household | Demographics | **Wording decision** |
| H01, H02, H21: join code readability | Accessibility | Added to H38 (no O, I or L) |

## Decisions this review surfaces for the owner

1. Should someone made organizer be unable to remove the person who made them one (H25)?
2. Should a declined requester be blocked from asking again (H26)?
3. Should a lodger or helper have a limited view instead of seeing everything (H29)?
4. Should a person who handed over still be an organizer, and should an organizer be able to leave (H23, H40)?
5. Should the invite email name the family to someone who may have received it by mistake (H37)?
6. Should the same car saved twice be merged or flagged (H38)?
7. Wording: the blame in H09, the "seen by every adult" for one adult, and the exclusion of a 17-year-old.
8. A takeover route when the only organizer dies, and a way to mark someone deceased.
