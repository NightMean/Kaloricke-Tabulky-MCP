# KT API contracts

The MCP tool list and examples live in [README.en.md](../README.en.md).
These notes describe the upstream contracts needed when changing the client.
KT's website API is undocumented and may change independently of this server.

## Transport and authentication

`src/kt/client.ts` owns the JSESSIONID, shared login renewal, JSON envelopes,
multipart requests and binary downloads. Feature clients receive an authenticated
request callback; they do not own credentials or create separate sessions.
`src/kt/api.ts` carries the MCP cancellation signal through each operation.
Requests time out after 20 seconds. Cancellation stops subsequent requests, but
cannot roll back a write KT has already accepted. Shared login continues for
other callers when one operation is cancelled.

JSON calls append `format=json`. Most return `{code, message, data}`; some lists
return `{requestId, count, data}` without `code`. A nonzero code or failed HTTP
status is an error. A login redirect triggers one shared login and replay of the
rejected request. Network failures and ambiguous writes are not replayed.
Do not use GET as a read-only classification: KT uses it for several mutations.

Dates are validated calendar dates in `dd.MM.yyyy`. Range starts must not follow
their ends. Only the streak query is translated to `yyyy-MM-dd` internally.
Raw statistics retain their upstream units and absent values.

## Diary entries

Implementation: `src/kt/diary.ts`, `src/mcp/diary-tools.ts`.

| Route (before `?format=json`) | Method and contract |
| --- | --- |
| `/user/diary/{date}/get` | GET: meal slots, food/recipe entry IDs, activities and notes. |
| `/user/diary/foodstuff/unit/form/{id}` | GET: `diaryGuid`, `multiplier`, `unitGuid`, `unitOptions`. |
| `/user/diary/foodstuff/unit/edit` | POST the form with an absolute `multiplier` and offered `unitGuid`. |
| `/user/diary/{foodstuff\|activity}/delete/{id}` | GET mutation: delete a logged entry, not its saved recipe. |
| `/user/diary/{id}/{mealId}/0/dragndrop` | GET mutation: move a food/recipe to another slot. |
| `/user/diary/{id}/0/{date}/dragndrop` | GET mutation: move a food/recipe to another day. |
| `/user/diary/copy` | POST diary with target date and explicit `selected` flags on every food/activity. |
| `/user/diary/note/add` | POST `{date, time: mealId, note: text}`. |
| `/user/diary/note/delete/{id}` | GET mutation: delete an existing note ID. |

Corrections verify entry membership in the source date before mutation. Food IDs
from search, saved recipe IDs, and diary entry IDs are separate identifiers.
Copies add entries without replacing the destination and may duplicate them if
retried after an uncertain result. Inspect the destination first.

## Recipes

Implementation: `src/kt/recipes.ts` and the legacy create/log methods in
`src/kt/client.ts`; tools in `src/mcp/recipe-tools.ts` and `src/mcp/tools.ts`.

`/user/meal/add/form/{id}` supplies the logging form. `log_meal.portions`
multiplies every selected ingredient's original count in the **whole saved
recipe**. The percentage unit is discovered by `multiplier=-1`; its ID must not
be assumed. `selectedUnitMultiplier=portions*100` controls the displayed amount.
Changing only top-level `count` does not scale nutrition or set the label.

`/user/diary/meal/edit/form/{entryId}` instead supplies original ingredient
counts for the **current logged entry**. `edit_diary_recipe.factor` multiplies
those counts and the existing display multiplier, then POSTs `/user/meal/edit`.
For example, halving a half-recipe entry produces quarter calories and `25%`.
Original ingredient units are restored; deselected ingredients get zero.

The saved-recipe editor reads `/user/settings/meal/edit/form/{id}/` and POSTs
`/user/settings/meal/detail/edit/{id}`. It preserves unspecified metadata and
visibility. Ingredient replacement uses `/recipe/form/item/{foodId}` and its
native `unitCount`, `selectedUnitGuid` and `units`; the diary ingredient shape
is different and must not be substituted. Omitted ingredient units use that
food's base multiplier, including millilitres for liquids.

Images POST multipart field `file` to
`/user/settings/meal/detail/{id}/image/create`. Do not set a JSON Content-Type
on FormData. Client validation checks base64, size and PNG/JPEG signatures;
KT validates image decoding during upload. Upload adds an attachment; inspect
recipe image metadata before retrying an uncertain result. The 5 MiB decoded
limit requires 7 MiB HTTP/proxy JSON limits. Other JSON endpoints stay at 1 MiB.

## Statistics and activities

`src/kt/statistics.ts` reads `/statistic/{metric}/{from}/{to}/get` for `energy`,
`nutrients`, `drink`, `weight` and `optional`. The last returns an array of custom
series, not one object. `get_weight_history` retains its older monthly summary
contract. Tips use `/statistic/analysis/tips/{from}/{to}/get?top=true`; streak
uses `/user/streak?date=yyyy-MM-dd` and returns an integer.

`src/kt/activities.ts` searches `/autocomplete/activity`, reads
`/user/activity/add/form/{id}`, and POSTs the form to `/user/activity/add`.
Minutes are converted to the native `hrs`/`min` duration unit. `time` is duration;
`timeOfInsert` is the optional `HH:mm` clock time. Corrections use
`/user/diary/activity/unit/form/{entryId}` and POST
`/user/diary/activity/unit/edit` with `multiplier` in the form's `unit`.

## Account libraries

- `src/kt/preferences.ts` reads favorite/common food/activity catalogs. Favorite
  add/remove routes are GET mutations. Profile reads allowlist nutrition fields;
  the source form also carries payment/authentication fields that must not be
  returned through MCP or logged.
- `src/kt/templates.ts` lists templates, reads `/user/templates/form/{id}`,
  creates whole-day templates through `/user/templates/diary/{date}/create`,
  and applies through `/user/templates/diary/write` with `datesToAdd: [date]`.
  Application uses saved quantities and clears cross-account share fields.
  Deleting a template does not remove past diary entries.
- `src/kt/measurements.ts` discovers types through `/user/track/form`, creates
  trackers through `/user/track/add` without an initial value, and POSTs dated
  values to `/user/track/value/add`. Tracker ownership is checked against
  `optional` series, excluding weight. `/user/track/delete/{id}/` is a GET
  mutation deleting the entire tracker and its history.

## Exports and verification

`src/kt/exports.ts` downloads `/user/export/{xls|pdf|analysis}/{from}/{to}/get`
without `format=json`. The server labels these as `application/force-download`;
file signatures distinguish OLE XLS, ZIP XLSX and PDF. Analysis is a PDF.
Declared and streamed downloads are bounded to 5 MiB. `export_diary` embeds
bytes in an MCP resource without persisting a file or publishing a URL.

Run `npm test` from the repository root. It includes deterministic client/MCP
contract tests and a real local OAuth/HTTP process test with isolated fixture
credentials/state. It never writes to a KT account. Live integration requires
separately configured credentials and temporary records with verified cleanup.

The contracts above were checked against the Slovak site's first-party
[diary controller](https://www.kaloricketabulky.sk/resources/js/public/controller-diary-8daf35f29b5b7209f27c596a3895050b.js),
[statistics controller](https://www.kaloricketabulky.sk/resources/js/public/controller-statistic-1d6f1985bcae458d22685ff4d1b291c7.js),
[settings controller](https://www.kaloricketabulky.sk/resources/js/public/controller-user-settings-12e296166e69dc4a60a571db0230be3f.js),
and [recipe editor](https://www.kaloricketabulky.sk/resources/js/public/controller-user-settings-meals-edit-b06458f747f6c813e9347d6473a3f070.js)
on 2026-10-23. Account availability and Czech-site parity require separate
verification; source inspection alone is not live acceptance evidence.
