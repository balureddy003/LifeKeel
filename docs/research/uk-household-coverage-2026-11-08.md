# UK household simulation: expected outcomes and results

**Summary (staging, 2026-11-08): 85 expectations, 80 met, 5 not met.** The five are three findings for the owner:

1. **A request to join shows the family's name to the person asking (H08).** Anyone with the invite code gets the family name back on the waiting reply. For someone escaping a controlling partner who has found the code, that confirms the family is here. Suggested expectation: say only "the family will be asked".
2. **"Seen by every adult" ignores adults who have not joined (H09, H10).** An adult on the family list who has no login is not counted, so the list can read as seen by everyone when Grandad has not looked. But a dependant adult who cannot confirm (H10) should not hold it up. Both cannot be true today: the product has no way to mark "does not need to confirm" apart from "has not joined yet". It also has no dependant or carer role. Both are owner decisions.

Not tested here (needs people or legal input): wording for each UK nation (England, Scotland, Wales, Northern Ireland differ on succession and guardianship), low digital confidence, assistive technology, English as an additional language.

Run mw7zn2ov against staging. Expectations are written from the family's point of view, not from the code. **Not met** is a finding: a product gap, or an expectation the owner should change. [DECISION] marks expectations that depend on a product call.

## H01 Married couple, two young children

_Ada and Ben Pemberton, children aged 7 and 4. Ada sets everything up; Ben joins._

| Stage | The family should experience | Result |
|---|---|---|
| 1 Sign up | Ada can sign up and create the family | met |
| 2 Set up | both children can be added with their birth dates | met |
| 3 Join | Ben can ask to join with the code, Ada approves, and Ben can then sign in | met |
| 4 The list | Ada can put the family car on the list and it appears once | met |
| 5 Seen by everyone | before anyone confirms, the list does not say everyone has seen it | met |
| 5 Seen by everyone | when only Ada has confirmed, it still waits for Ben | met |
| 5 Seen by everyone | when both parents have confirmed it says every adult has seen it | met |
| 5 Seen by everyone | the children are not asked to confirm | met |
| 6 Change | after the car list changes, both parents must look again | met |
| 7 Who can do what | Ben cannot change the list until Ada allows it | met |
| 7 Who can do what | once Ada allows it Ben can change the list straight away, without signing in again | met |

## H02 Cohabiting couple, no children

_Elin and Farid share a flat. Elin organizes._

| Stage | The family should experience | Result |
|---|---|---|
| 3 Join | Farid has a different surname and can still join and sign in | met |
| 5 Seen by everyone | with two adults, one confirming is not enough | met |
| 5 Seen by everyone | both confirming completes it | met |
| 2 Set up | a household with no children is not asked for any | met |

## H03 Single person living alone

_Sophie lives alone and keeps her own list._

| Stage | The family should experience | Result |
|---|---|---|
| 5 Seen by everyone | before she confirms it is not marked as seen | met |
| 5 Seen by everyone | Sophie confirming on her own completes it (no second adult is needed) | met |
| 5 Seen by everyone | she is not told she is waiting for someone else | met |

## H04 Lone mother with a young son

_Mia and Noah, aged 7. No other adult._

| Stage | The family should experience | Result |
|---|---|---|
| 2 Set up | Mia can add her son as "my child" | met |
| 5 Seen by everyone | Mia alone completes the confirmation; her son is not required | met |
| 7 Who can do what | a child cannot be given the right to change the list | met |

## H05 Lone father with a 16-year-old who has her own login

_Karl and Liv. Liv signs in on her own phone._

| Stage | The family should experience | Result |
|---|---|---|
| 3 Join | Liv can sign in on her own phone after her father approves | met |
| 7 Who can do what | a 16-year-old cannot read the adults' list (she gets an explanation, not the records) | met |
| 7 Who can do what | she cannot add to the list | met |
| 5 Seen by everyone | her father alone completes the confirmation; Liv is not asked | met |

## H06 Blended family: his child, her child, their child

_Dan and Eve. Fay is Dan's, Gus is Eve's, Hal is theirs._

| Stage | The family should experience | Result |
|---|---|---|
| 2 Set up | all three kinds of child relationship are accepted | met |
| 2 Set up | the relationship shown for each child is the one chosen | met |
| 5 Seen by everyone | both adults confirming completes it; none of the three children holds it up | met |

## H07 Separated parents, shared custody

_Gareth and Hannah split up. Hannah is the organizer and removes Gareth from the family list._

| Stage | The family should experience | Result |
|---|---|---|
| 3 Join | while together, both could see and confirm | met |
| 8 Separation | Hannah can remove Gareth | met |
| 8 Separation | Gareth is cut off at once, even though he is still signed in on his phone | met |
| 8 Separation | Gareth can no longer see anything about the family (names, children, invite code) | met |
| 8 Separation | Gareth cannot sign in again | met |
| 8 Separation | the list no longer waits for Gareth: Hannah's own confirmation completes it | met |
| 8 Separation | after Hannah changes the invite code, Gareth cannot ask to come back with the old one | met |

## H08 Safety first: someone who should not be in tries to join

_Ife has left a controlling partner, Marcus, who has found the invite code. Ife must stay in control of who is let in._

| Stage | The family should experience | Result |
|---|---|---|
| 3 Join | a request with the code is held until Ife decides, and the person is told only that the family will be asked | **not met**: {"status":"pending","family_name":"The Adeyemi family mw7zn2ov"} |
| 3 Join | the person asking learns nothing about who is in the family | **not met**: {"status":"pending","family_name":"The Adeyemi family mw7zn2ov"} |
| 3 Join | Marcus cannot get in while his request is waiting | met |
| 3 Join | Ife sees the request and can decline it | met |
| 3 Join | declining removes the request | met |
| 8 Separation | after the code is changed, the old code stops working for him | met |
| 8 Separation | Marcus still has no way in | met |

## H09 Three generations under one roof

_Hana (organizer), her partner Ian, Nan, and Grandad who has not joined. Two children._

| Stage | The family should experience | Result |
|---|---|---|
| 2 Set up | Hana can list Grandad as an adult who has not joined yet | met |
| 5 Seen by everyone | the three who have joined confirming does not count as every adult while Grandad has not seen it **[DECISION]** | **not met**: {"all":true,"required":["Hana Okoye","Ian Okoye","Nan Okoye"],"confirmed":["Hana Okoye","Ian Okoye","Nan Okoye"]} |
| 5 Seen by everyone | the screen names Grandad as the one still to see it **[DECISION]** | **not met**: ["Hana Okoye","Ian Okoye","Nan Okoye"] |
| 7 Who can do what | Nan cannot change the list unless Hana allows it | met |
| 7 Who can do what | Hana can let Ian, but not Nan, change the list | met |

## H10 Carer for an adult with a learning disability

_Jo cares for her brother Sam, 34. Sam is on the family list but cannot manage confirming things._

| Stage | The family should experience | Result |
|---|---|---|
| 2 Set up | Jo can put an adult dependant on the family list | met |
| 5 Seen by everyone | Jo confirming completes it; Sam is not held to confirm **[DECISION]** | met |
| 2 Set up | there is a way to mark someone as a dependant adult, not just adult or child **[DECISION]** | **not met**: roles are organizer, parent, adult, child only |

## H11 Widowed parent with two children

_Wendy lost her husband Tom. She removes him from the list and wants to know what to do next._

| Stage | The family should experience | Result |
|---|---|---|
| 8 Bereavement | Wendy can remove Tom from the family list | met |
| 8 Bereavement | Tom no longer appears on the list | met |
| 8 Bereavement | she can open first steps for a family member, without being asked for anything else | met |
| 5 Seen by everyone | Wendy alone completes the confirmation | met |

## H12 Two mums and an adopted daughter

_Priya and Zara, with Mei, 6._

| Stage | The family should experience | Result |
|---|---|---|
| 3 Join | two adults of the same gender join as equals | met |
| 2 Set up | the product never labels anyone mother, father, husband or wife | met |
| 5 Seen by everyone | both mums confirming completes it | met |

## H13 Aunt raising her niece (kinship care)

_Kiran looks after her niece Asha, 9, who is not her own child._

| Stage | The family should experience | Result |
|---|---|---|
| 2 Set up | Kiran can add a child who is not hers, with a label that says so | met |
| 5 Seen by everyone | Kiran alone completes the confirmation | met |

## H14 Three friends sharing a house

_Lena, Mo and Nell, all in their twenties, run a shared car list._

| Stage | The family should experience | Result |
|---|---|---|
| 3 Join | both housemates can join with different surnames | met |
| 5 Seen by everyone | two of three confirming is not enough | met |
| 5 Seen by everyone | all three confirming completes it | met |
| 8 Someone leaves | when Nell moves out, the list stops waiting for her | met |

## H15 Adult children at home, and a 17-year-old

_Rohan, 19, and Rina, 17, live with their parents Sunita and Vik._

| Stage | The family should experience | Result |
|---|---|---|
| 3 Join | Rina, 17, can sign in | met |
| 5 Seen by everyone | a 17-year-old is treated as a child: she is not asked to confirm, even if listed as an adult | met |
| 7 Who can do what | Rina cannot change the list | met |

## H16 Self-employed couple with two cars

_Omar and Pat both drive for work; one MOT is overdue, one is soon, one is far off._

| Stage | The family should experience | Result |
|---|---|---|
| 4 The list | the overdue MOT is shown first, so it cannot be missed | met |
| 4 The list | then the soonest, then the next, in date order | met |
| 4 The list | a date months away is not nagged about yet | met |

## H17 Handing over the family list to a partner

_Quinn has been organizer but his partner Rae now runs the household admin._

| Stage | The family should experience | Result |
|---|---|---|
| 8 Handover | Quinn can make Rae an organizer | met |
| 8 Handover | Rae can then see and approve join requests straight away | met |
| 8 Handover | and approve them | met |

## H18 A street of names from everywhere

_Welsh, Irish, Polish, Somali, Tamil, Chinese and Nigerian names, with apostrophes, accents and hyphens._

| Stage | The family should experience | Result |
|---|---|---|
| 2 Set up | every name is kept exactly as typed (accents, apostrophes, hyphens, Chinese characters) | met |
| 4 The list | the list screen loads for a household with these names | met |

## H19 Three families called Smith

_The Smiths, all picking the same family name on the same day._

| Stage | The family should experience | Result |
|---|---|---|
| 1 Sign up | the first Smith gets in | met |
| 1 Sign up | the others are told the name is taken and can choose another, not shown an error | met |
| 1 Sign up | the second Smith succeeds with a different name | met |

## H20 Large extended family

_Four adults and five children in one house._

| Stage | The family should experience | Result |
|---|---|---|
| 5 Seen by everyone | three of four adults confirming is not enough | met |
| 5 Seen by everyone | all four adults confirming completes it; the five children are not asked | met |
| 4 The list | the list opens in under 3 seconds | met |

## H21 A new partner moves in

_Tess and her new partner Uri. The family list already exists and has been confirmed._

| Stage | The family should experience | Result |
|---|---|---|
| 5 Seen by everyone | Tess alone had completed it | met |
| 3 Join | once Uri joins, the list is no longer shown as seen by every adult until he has looked | met |
| 5 Seen by everyone | when Uri confirms it is complete again | met |

## H22 A partner who waited too long (needs staging controls)

_Val asked her partner to join but never approved; two weeks later it lapses._

| Stage | The family should experience | Result |
|---|---|---|
| 8 Time | after 14 days the unanswered request has gone from Val's list | met |
| 8 Time | Wil can ask again and is not told he already asked | met |
