# MCP tool reference


| Tool | Purpose |
|---|---|
| `search_food` | Find foods by Czech/Slovak name or 13-digit EAN barcode. Returns the food id the other tools need. |
| `get_food_portions` | List a food's natural portion units (`kus (55 g)`, `velký kus (60 g)`) so "3 eggs" logs as three pieces rather than an estimated weight. |
| `get_food_nutrition` | Calories and macros for a quantity, scaled by the site itself. Read-only. |
| `log_food` | Write an eating record into the diary (supports `dry_run: true` to preview macros without logging). |
| `get_day_summary` | Read back a day's totals and structured overview (current/target/remaining calories, macros, water). |
| `get_diary` | Read food/recipe entries, IDs, meal slots, activities and notes. |
| `get_day_entries` | Read normalized entries, portions and macros by meal, with totals calculated from the entries. |
| `get_logged_days` | List recorded days and their colour ratings in the site's current calendar window. |
| `get_diary_food_units` | Read current quantity and offered units before editing. |
| `edit_diary_food` | Replace a food entry quantity; supports `dry_run`. |
| `delete_diary_entry` | Delete one logged food/recipe or activity; supports `dry_run`. |
| `move_diary_food` | Move a food/recipe to another slot or date; supports `dry_run`. |
| `copy_diary_entries` | Copy selected entry IDs to another date; supports `dry_run`. |
| `add_diary_note` / `delete_diary_note` | Add a meal-slot note or delete a note by date and ID; supports `dry_run`. |
| `search_activity` | Search activities with zero-based pagination. |
| `get_activity` | Read a database activity and its native duration unit. |
| `log_activity` | Record activity duration in minutes, with optional `HH:mm` time and `dry_run`. |
| `edit_diary_activity` | Replace a logged activity duration; supports `dry_run`. |
| `record_weight` | Log user body weight (kg) for a given date (supports `dry_run: true`). |
| `get_weight_history` | Retrieve recent body weight entries from monthly tracking statistics. |
| `get_statistics` | Read energy, nutrient, water, weight or custom measurement series for an explicit `from`/`to` range. |
| `get_period_analysis` | Read per-day averages against targets and the foods contributing most to each nutrient. |
| `get_tracking_tips` | Read the website's tips for a date range. |
| `get_tracking_streak` | Read tracking streak information for a date. |
| `create_meal` | Save a recipe built from existing foods. |
| `list_my_meals` | List saved recipes with ids/energy, query filtering and zero-based `page`/`limit` pagination. |
| `log_meal` | Log a saved recipe into the diary with optional portion scaling (supports `dry_run: true`). |
| `delete_meal` | Delete a saved recipe. |
| `get_recipe` | Read saved recipe ingredients, instructions, servings and image metadata. |
| `edit_recipe` | Edit saved recipe metadata/ingredients while preserving visibility; supports `dry_run`. |
| `edit_diary_recipe` | Scale the current logged recipe by `factor`; supports `dry_run`. |
| `upload_recipe_image` | Attach a PNG/JPEG image (base64, maximum 5 MiB); supports `dry_run`. |
| `get_favorites` / `get_common_items` | Read favorite or commonly used foods/activities. |
| `set_favorite` | Set or remove favorite membership; supports `dry_run`. |
| `get_profile` | Read nutrition-related settings and goals; omits authentication/payment fields. |
| `list_templates` / `get_template` | List owned diary templates and read their contents. |
| `create_template_from_diary` | Save all foods from one day, optionally activities/notes; supports `dry_run`. |
| `apply_template` / `delete_template` | Add saved quantities to one date or delete the saved template; supports `dry_run`. |
| `get_measurement_types` / `list_measurement_trackers` | Discover body/custom trackers and their units; weight remains separate. |
| `create_measurement_tracker` / `record_measurement` | Create a tracker without an initial reading, then record a dated value; supports `dry_run`. |
| `delete_measurement_tracker` | Delete a non-weight tracker and all its history; supports `dry_run`. |
| `export_diary` | Download diary XLS/PDF or analysis PDF as an embedded MCP document, maximum 5 MiB. |


`get_day_entries` defaults to today and returns normalized entry IDs, database
food/recipe IDs, quantities, nutrients, activities and notes. Its meal and day
totals are summed from available food-entry values, because the upstream totals
can be zero. Missing numbers remain `null`; activity energy is not subtracted.
`get_diary` keeps the unmodified payload for correction tools and diagnostics.

`get_logged_days` covers the site's current window, roughly the last month;
it does not enumerate all history. Older individual dates remain readable.

`get_period_analysis` uses inclusive `from` and `to` dates. Its averages include
empty days: `someDaysWithoutRecords=true` warns that they lower the averages;
`null` means the upstream response omitted this indicator. `top` defaults to 5
foods per nutrient (0–10; 0 omits rankings). Set `by_category=true` to include
category rankings. Values retain the site's units and daily averaging basis.

`get_day_summary` keeps the original statistics response in `summary` and its
`raw` alias. The `overview` combines energy from statistics with water and macro
goals from the separate diary summary. Water uses the diary's more precise
display values, falling back to statistics when unavailable. Litres are converted to
millilitres; energy retains the site's unit. Missing values remain `null`.
If either API request fails, the tool reports an error.

Diary correction tools require a date and an entry ID from `get_diary`. They
check membership before changing anything. `edit_diary_food.amount` is an
absolute quantity, not a multiplier of the previous entry. Recipe IDs from
`list_my_meals` and food IDs from search are not diary entry IDs.
`move_diary_food` accepts exactly one destination: `meal` or `target_date`.
Copying adds entries without replacing the destination. If a copy request
loses its acknowledgement, read the destination before retrying to avoid
duplicates. Network failures are not automatically retried.
Tool logs contain operation names and outcomes, without diary arguments.

For `log_food`, `log_meal`, and `record_weight`, set `dry_run: true` for a
preview without writing. Omitting `dry_run` or setting it to `false` writes
immediately. Both modes validate the date, including calendar validity;
failed food or recipe lookups are reported as preview errors.

## Recipes

The site calls a saved recipe a *meal*. `create_meal` composes one from
existing foods, so "3 eggs and 200 ml milk" becomes a single reusable item
rather than two entries typed out every time.

Quantities follow the same rule as `log_food`: `amount` counts **units**, not
grams. Omitting `unit_id` selects the food's own base unit, which is grams for
solids and millilitres for liquids — what recipes are normally written in. Pass
a `unit_id` from `get_food_portions` and the count multiplies it, so 2 of
`porce (250 ml)` is 500 ml. Getting this backwards is easy: an early test asked
for 100 of the `100 ml` unit and quietly created a recipe containing ten litres
of milk.

`log_meal` multiplies the whole saved recipe by `portions` (default `1`).
For example, `portions: 0.5` scales every selected ingredient by half and
appears as `50 %` in the website diary. The client uses the form's supported
percentage unit and `selectedUnitMultiplier`; changing `count` alone does not
set the displayed quantity correctly.

`edit_diary_recipe.factor` multiplies the **current diary entry**, unlike
`log_meal.portions`, which multiplies the whole saved recipe. Halving an
already logged half recipe therefore leaves a quarter recipe and a `25 %`
label. Editing a saved recipe does not change historical diary entries.
`edit_recipe.ingredients` replaces all ingredients; omitted fields and the
recipe's visibility are preserved. An empty instruction list clears the steps.
Image upload adds an attachment; inspect `get_recipe` after an uncertain
failure before retrying. API requests time out after 20 seconds without
automatically repeating an uncertain write.
HTTP failures are errors even when their response body contains `code: 0`.
MCP cancellation aborts in-flight API calls and prevents subsequent requests.
A write already accepted by KT may still complete; inspect the diary before
retrying it. Shared login renewal continues for other callers.
The authenticated MCP route accepts up to 7 MiB of JSON to carry a 5 MiB
base64 image. Other JSON routes retain the 1 MiB limit. Reverse proxies must
allow the corresponding request size too.


See [API contracts](API.md) for upstream endpoints and [local MCP setup](LOCAL-MCP.md) for stdio.
