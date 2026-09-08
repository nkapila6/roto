# Rights and attribution

This workflow produces a derivative work. Not "inspired by" - the output frames literally contain
the reference's pixels. That is the whole point of the technique, and it is why the rights question
is a gate at the start rather than a footer at the end.

## The gate

Ask these before decoding a frame. Every answer goes in `THIRD_PARTY.md`.

**1. Who made the reference, and where did the user get it?**

Downloading a video is not acquiring a license to it. A public post is not a license. "It was on
their showreel" is not a license. Get a name and a source URL.

**2. What permission actually exists?**

One of: the user made it, the user commissioned it and holds the rights, the user licensed it for
derivative use, or the author has explicitly agreed to this adaptation. Anything else is a no.

Things that are not permission: "it's internal only", "it's a study", "we're not publishing it",
"we'll credit them", "everyone does this", "it's fair use" asserted rather than assessed.

If the user says they have permission, record what form it takes. You are not their lawyer and you
do not need to verify it, but the claim should be written down rather than assumed.

**3. The soundtrack, separately.**

Music rights almost never travel with permission to adapt visuals. The person who made the animation
usually licensed the track for that piece, and that license does not extend to your version. Treat
audio as a separate question every time.

Put it to the user rather than deciding silently. `node scripts/soundtrack.mjs list` prints the
catalogue of free and permissively licensed sources with their terms; `use` wires the choice and
writes the attribution record in one step. The composition does not need the reference audio to
work, and silent is always a legitimate answer.

Three licence traps worth naming when you present the options:

- **NC (non-commercial)** rules out anything the user will use to sell or promote a product.
- **SA (share-alike)** propagates its terms to the work it is embedded in.
- **Aggregator sites set licences per track.** Free Music Archive, ccMixter, Freesound, the Internet
  Archive and Openverse each host tracks under different licences, so "I got it from FMA" says
  nothing about what you may do with it. Read the track page.

**4. Fonts.**

You will not have the reference's font and should not extract it from the video. Pick your own and
license it. See `deterministic-render.md` § Fonts for how to pin it without redistributing it.

**5. Trademarks in the reference.**

Logos, wordmarks, and product names in the source belong to whoever owns them. Clear them out in
Phase 2 like any other lettering - the `patch-copy` strategy exists largely for corner identities.
Transplanting a brand mark into a video for a different brand is a different and worse problem than
adapting motion.

## If an answer is missing

Say so plainly and stop. Not as a lecture - one or two sentences naming the specific gap.

Then offer the real alternative: an original composition in the same *style*, built through
`/general-video`. Style is not protectable in the way a specific work is, and a competent original
build in the same visual language needs no permission from anyone. It costs more, which is worth
saying, and it is a deliverable the user can actually ship.

Do not proceed on a promise to sort the rights out later. The plates are the deliverable's
foundation; there is no version of this where they get swapped out at the end.

## What to say about the output

Three claims to avoid, because they are false and because the falsity is checkable:

- **"Recreated from scratch."** It is not. The backgrounds are source pixels.
- **"Pixel-identical to the reference."** It cannot be. The typography changed, which was the point.
- **"Fully reproducible on any machine."** See `deterministic-render.md` § What determinism does not
  promise.

What is true and worth saying: this is a reference-based adaptation that preserves the original
motion and re-authors the typography, the process is inspectable, and the result verifies against a
published hash.

Credit the original designer in the README even when permission is explicit and even when the user
paid for it. The motion is theirs, and a reader looking at the output cannot tell that from the
frames alone.

## `THIRD_PARTY.md` template

```markdown
# Credits and asset provenance

- **Original reference and motion design:** <Name>, <handle or studio>. <source URL>.
  <How this project obtained it and under what permission.> `reference/original.<ext>`,
  `assets/<audio>`, and the source-derived background plates all originate from that reference.
  <State explicitly if no broader redistribution rights are granted.>

- **Soundtrack:** <author / library / license, or: replaced with <track> via <source>, or:
  rendered silent because no music license was supplied.>

- **<Font name> <version>:** <foundry>. <font page URL>. Governed by <license URL>. Downloaded
  directly from <source> after explicit license acceptance; not committed to this repository. Its
  SHA-256 is pinned in `assets-manifest.json`.

- **HyperFrames <version>:** https://github.com/heygen-com/hyperframes - Apache-2.0. Installed with
  npm, not vendored.

- **<Any brand or product name appearing in the replacement copy>:** names and trademarks belong to
  their respective owners. No affiliation or endorsement is claimed.

The renderer and its scripts are included for inspection and reproducibility. This publication does
not claim ownership of the reference artwork, and attribution does not grant a license to
redistribute the reference or its soundtrack elsewhere.
```

## README language that holds up

A short paragraph near the top, not buried at the bottom:

> **Credit and method:** <Name> created the original motion design. This project adapts that
> supplied reference: <N> text-cleared source frames preserve its backgrounds and control
> animations, while JavaScript renders the replacement typography. The result is a reference-based
> adaptation, not original motion invented from scratch.

It costs three lines and it is the difference between a documented adaptation and an
uncredited copy.
