Read 
Completed with input: {
  "path": "C:\\Users\\pderm\\dev\\openmic\\AGENTS.md"
}

Read , lines 1 to 220
Completed with input: {
  "path": "C:\\Users\\pderm\\dev\\openmic\\docs\\decisions.md",
  "view_range": [
    1,
    220
  ]
}

Searched codebase for "home page open mic discovery 50km radius location search other cities empty results", 19 results

Search for `50|radius|discover|HomePage|location`

Read , lines 90 to 205
Completed with input: {
  "path": "C:\\Users\\pderm\\dev\\openmic\\docs\\decisions.md",
  "view_range": [
    90,
    205
  ]
}

Search for `50.?km|radius|home page|Home Page|discovery`

Find files matching `**/*Home*Page*`

Read , lines 165 to 205
Completed with input: {
  "path": "C:\\Users\\pderm\\dev\\openmic\\docs\\decisions.md",
  "view_range": [
    165,
    205
  ]
}

Read , lines 1 to 240
Completed with input: {
  "path": "C:\\Users\\pderm\\dev\\openmic\\apps\\web\\src\\views\\HomePage.tsx",
  "view_range": [
    1,
    240
  ]
}

A potential solution is to make **50 km the starting point, rather than a discovery dead end**. There are three parts we can shape together:

- **Expand the area:** let users find open mics farther away, even when local results exist.
- **Explore another place:** let users choose a city without having to change their account’s home location.
- **Make empty results actionable:** explain the current search area and offer a clear next step.

These are candidate directions, not settled decisions. The first important choice is whether searching farther away should happen automatically or only with the user’s permission.


Ask User
Completed with input: {
  "question": "When there are no open mics within 50 km, how would you like the home page to respond?",
  "choices": [
    "Keep the 50 km search unchanged and offer “Expand distance” and “Search another city” actions",
    "Automatically widen the radius until results appear, clearly showing the new distance",
    "Keep the local empty state, but show a separate “Farther away” section with the nearest alternatives"
  ]
}

Ask User
Completed with input: {
  "question": "For “Expand distance”, what kind of control would you prefer? It could also remain available when local results exist, so users can deliberately see more.",
  "choices": [
    "A distance selector with fixed choices, such as 50, 100, 200 and 500 km",
    "A “Search farther” button that increases the radius one step at a time",
    "A custom distance field or slider so users choose their own radius"
  ]
}

Yes — that gives **“Expand distance” a useful, data-driven destination**, rather than an arbitrary next radius.

The potential experience would be:

- Keep the current 50 km results unchanged.
- Suggest the smallest wider radius containing **at least 20 additional open-mic listings** beyond the current radius.
- Show an action such as **“Expand to 135 km · 23 more open mics”**. The count could exceed 20 when several listings fall within the suggested boundary.
- Expand only when the user selects that action. The same option could be available whether there are zero local results or plenty.
- Count additional matching listings, not merely cards currently hidden from view.

One important consequence: in a sparsely populated area, finding 20 more could require a very large distance.


Ask User
Completed with input: {
  "question": "Should that suggested expansion have a distance limit, even if it means finding fewer than 20 additional open mics?",
  "choices": [
    "No fixed limit: suggest whatever radius reaches 20 more, clearly displaying the distance",
    "Cap the suggestion at a maximum distance and offer however many exist within it",
    "If reaching 20 requires a very large distance, suggest searching another city instead"
  ]
}

Ask User
Completed with input: {
  "question": "What should count as a “very large distance”, beyond which we suggest another city instead of a wider radius? These are straight-line distances, not driving distances.",
  "choices": [
    "More than 100 km",
    "More than 200 km",
    "More than 500 km"
  ]
}

That sets a clear boundary: suggest a radius that adds at least 20 open mics **only if it is within 200 km**; otherwise, guide the user toward another city.

For city exploration, there are two different experiences: searching within the city itself, or treating that city as a new starting point for a nearby search.


Ask User
Completed with input: {
  "question": "When someone chooses another city, what area should the results cover?",
  "choices": [
    "Within 50 km of the selected city, with the same expansion option",
    "Only listings in the selected city",
    "Let the user choose between city-only and nearby results"
  ]
}

Ask User
Completed with input: {
  "question": "If there are some additional open mics within 200 km, but fewer than 20, should we still offer them alongside the suggested cities?",
  "choices": [
    "Yes: offer “Show N more within 200 km” alongside city suggestions",
    "No: offer only city suggestions when we cannot reach 20 additional open mics within 200 km"
  ]
}

Ask User
Completed with input: {
  "question": "The home page has both upcoming events and open-mic series. Should changing the city or radius affect both sections, while calculating expansion suggestions from the number of additional open-mic series?",
  "choices": [
    "Yes: use one shared location and radius for both sections; base expansion suggestions on open-mic series",
    "No: apply these controls only to the open-mic series section",
    "Use separate city and radius controls for each section"
  ]
}

Ask User
Completed with input: {
  "question": "For suggested cities, should a city qualify only if it has an open-mic listing in the city itself, or if there is a listing within its 50 km search area? Either way, suggestions would be ordered by distance from the current search location.",
  "choices": [
    "Only cities with at least one open-mic listing in the city itself",
    "Cities with at least one open-mic listing within 50 km"
  ]
}

Ask User
Completed with input: {
  "question": "The home page currently previews just three cards in each section. How should users browse the fuller results after expanding the radius or choosing a city?",
  "choices": [
    "Keep short home-page previews and add “View all” leading to a dedicated results page",
    "Browse the full results directly on the home page using “Load more”",
    "Browse the full results directly on the home page using pagination"
  ]
}

Ask User
Completed with input: {
  "question": "How long should a manually selected city or expanded radius remain active? This would be a browsing preference, separate from the account’s saved home city.",
  "choices": [
    "Keep it while browsing, including returning from a listing, but reset on a later visit",
    "Remember it across visits until the user chooses “Near me” or another city",
    "Reset it whenever the user returns to the home page"
  ]
}

Ask User
Completed with input: {
  "question": "If the user has neither browser location nor a saved home city, what should the discovery experience show before they choose a location? City suggestions cannot be ordered by distance until a starting location is known.",
  "choices": [
    "Keep the existing general previews, with prominent “Use my location” and “Choose a city” actions",
    "Ask the user to choose a city or use their location before showing results",
    "Show cities with open mics, ordered by listing count, alongside “Use my location”"
  ]
}

## Proposed experience

**Keep 50 km as the default, but give users clear ways to widen their search or explore another city.** Searches never expand automatically.

### 1. Make the search area visible and changeable

The home page would show the active location and radius, for example:

**Near Bristol · Within 50 km**

Alongside it:
- **Expand distance**
- **Choose a city**
- **Near me**, to return from a manually selected city to the user’s local area

These controls remain available even when local results exist. One shared location and radius applies to both **upcoming events** and **open-mic series**.

### 2. Suggest a useful expansion based on available listings

Rather than offering arbitrary distance increments, suggest the smallest wider radius that includes **at least 20 additional open-mic series** beyond the current search area.

Example:

> **Expand to 120 km · 22 more open mics**

The user must select the action before the search changes.

| Availability | Experience |
|---|---|
| At least 20 additional open mics can be reached within 200 km | Offer the smallest radius that reaches that target. |
| Some additional open mics exist within 200 km, but fewer than 20 | Offer **“Show N more within 200 km”**, alongside suggested cities. |
| No additional open mics exist within 200 km | Direct users toward suggested cities and city search. |

The expansion target is based on **open-mic series**, not upcoming-event counts or cards hidden from the home-page preview.

### 3. Make empty results actionable

Instead of an empty message alone:

> **No open mics found within 50 km of Bristol.**  
> Search farther away or explore another city.

Show the applicable expansion action and **Choose a city**.

The two sections retain their own empty states: no upcoming events does not mean there are no open-mic series.

### 4. Let users explore cities with open mics

**Choose a city** would support:
- Searching for a particular city.
- Suggested cities that actually contain at least one publicly discoverable open-mic listing.
- Suggestions ordered by distance from the **current search location**.

Selecting a city starts a **50 km search around that city**, with the same expansion options. It does not change the account’s saved home city.

### 5. Keep the home page concise

Retain the short previews, with **View all** leading to a dedicated results page for the relevant section.

That page carries through the chosen location and radius, so users can browse the fuller results rather than seeing only the preview cards.

### 6. Preserve exploration without making it permanent

- Keep the selected city and radius while browsing, including returning from a listing.
- Reset to the normal local discovery experience on a later visit.
- If no browser location or saved city is available, retain the existing general previews and prominently offer **Use my location** and **Choose a city**. Do not imply that suggestions are nearby without a known starting location.

This gives users three clear paths: **browse locally, widen deliberately, or explore somewhere else**—without silently changing what “near you” means.

No code or documentation changes made.