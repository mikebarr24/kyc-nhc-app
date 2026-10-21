# nhc-app

A small web app for scoring cruiser races under the RYA **National Handicap for Cruisers (NHC)**: race places, corrected times and the updated handicap for each boat after every race.

The maths follows the May 2015 NHC algorithm as written up by HalSail: <https://halsail.com/Help/pdfFaq?Faqitem=NhcMaths>.

## Using it

1. **Fleet:** add each boat with its NHC base number (H0).
2. **Races → New race:** set each boat that raced to `FIN` and enter its elapsed time (or switch to finish clock times and give the start time). Leave boats that didn't sail as `DNC`. The **?** beside each result explains the codes.
3. **Save & calculate:** shows places, corrected times and each boat's new handicap for the next race.
4. **Handicaps:** shows how every boat's handicap has moved over the season.

Results are recalculated from the first race every time, so fixing a time in an old race updates everything after it.

### Sharing results

Results are stored in a [Supabase](https://supabase.com) database. Each club has its own code: open the site, enter the code, and you see that club's boats and races. Anyone with the code can view and edit, and new results appear without refreshing. The browser remembers the code until you click **Change club**.

If `js/config.js` has no Supabase settings, there are no clubs and the app stores data in the current browser only.

### Supabase setup (one-off)

1. Create a free project at <https://supabase.com>.
2. **SQL Editor → New query**: paste `supabase/schema.sql` and run it.
3. **Project Settings → API**: copy the *Project URL* and the *anon* / *publishable* key into `js/config.js`, then commit and push.

The publishable key is meant to be public. The database rules in `schema.sql` only return or change rows for the club whose code comes with the request.

### Adding a club

In **SQL Editor**, run:

```sql
insert into public.clubs (name, code) values ('My Sailing Club', 'some-long-code');
```

Codes are case-insensitive and need at least 6 characters. Anyone can try codes on the landing page, so use something hard to guess, not the club's initials.

## How the calculation works

For each race, using only boats that finished:

- Corrected time `Tc = Te × H1` (rounded to the second); places are ordered by `Tc`.
- Achieved handicap `Ha = ΣH1 / (Te × Σ(1/Te))`.
- Provisional handicap `Hp = 0.7 × H1 + 0.3 × Ha`.
- Boats whose `Tc` is more than one standard deviation from the mean are *extreme performers*: their `Ha` is worked out as if they had finished exactly one standard deviation from the mean, so one bad or lucky race doesn't swing their handicap too far.
- Non-finishers and boats that didn't sail keep `Hp = H1`.
- **Realignment:** every boat that has sailed at least one race this season is scaled so `ΣH2 = ΣH0`, giving `H2 = Hp × ΣH0 / ΣHp`, rounded to 3 decimal places.

The halsail write-up doesn't say whether the standard deviation is the population or sample version. This app uses the population version (divide by *n*).

## Development

No build step. It is plain HTML, CSS and ES modules.

```sh
python3 -m http.server 8000   # then open http://localhost:8000
npm test                      # unit tests for the NHC maths (Node 20+)
```

- `js/nhc.js`: NHC calculations, no DOM.
- `js/app.js`: UI.
- `js/store.js`: storage (Supabase or browser).
- `js/config.js`: Supabase project settings.
- `supabase/schema.sql`: database tables, access rules and how to add a club.
- `test/nhc.test.js`: tests.
