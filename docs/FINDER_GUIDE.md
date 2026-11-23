# Find a space

The application has two interfaces on the same site:

- **Find a space** (`/find.html`) recommends one resource for one session at an
  exact start time.
- **AI workspace** (`/`) coordinates several competing requests and exposes
  the full search, evidence and decision experiments.

Both use the existing Python scheduling engine. Reservations made on either
page appear on the other page after it refreshes its state, provided both pages
use the same origin, browser profile and reservation storage mode.

## Search and reserve

1. Choose the kind of resource, date, exact start time, duration and group size.
2. Open preferences only when you need equipment, step-free access or a different
   starting floor. The starting floor is a stated assumption, not geolocation.
3. Search. The result identifies one recommended resource, its floor, time,
   capacity and the reasons it fits. No result means that the stated constraints
   could not be satisfied by the current sample inventory and reservations.
4. Review the details, then confirm a simulation reservation.
5. Check the receipt and the reservations section. Export or cancel as needed.

The simple page uses 30-minute slots from 08:00 to 20:00. The session must finish
by 20:00. An individual iMac serves one person. For a group using computers,
choose a whole computer lab in the sample inventory.

The Study, iMac, Meet and Auditorium presets select a resource type without
starting a search. The floor rail changes the assumed route origin and the
illustration's highlighted slice. It does not restrict results to that floor.
Use the rail's native buttons or Arrow keys, Home and End. Typed dates, times
and session names remain intact when using these controls.

Progress indicators observe actual search/review states; they do not simulate a search or trigger a reservation.

Changing search inputs invalidates the previous recommendation. A new search is
needed before confirming it. A result is a recommendation; only successful
confirmation creates a simulation reservation.

## Visible AI explanations

| AIF method | Role in the simple page |
| --- | --- |
| Constraint satisfaction | Excludes choices that fail capacity, equipment, access, time or reservation constraints. Whole-lab reservations conflict with their individual computers. |
| Hill climbing | Uses the existing seeded search and objective. The simple page sends one request; competition between several requests is demonstrated in the AI workspace. |
| A* graph search | Calculates an assumed route from the stated starting floor. It uses the sample graph, not a verified floor plan. |
| Bayesian inference | The engine supports a hypothetical availability report. With no report supplied by the simple page, the availability model retains the specified prior. It is not live occupancy. |
| Hidden Markov model | Requires a sequence of reports. The simple page does not supply one; the AI workspace provides the sequence experiment. |
| Finite-horizon belief-state planning | Supplies book/inspect/wait/leave advice after allocation. It does not determine the chosen placement or execute a reservation. The workspace exposes the assumptions and horizon. |

The placement score is an assumed utility, not a probability of a successful
real-world reservation. A score difference from first fit is meaningful only
under the stated objective. With one request, both methods may choose the same
resource; that is a valid outcome.

## Reservation storage

On the hosted demo, reservations are saved in the current browser profile.
On the Python local server, they are saved in its SQLite database. These are
simulation calendars; they do not reserve university facilities. The page
identifies the storage mode it is using.

## Design references

The campus-atlas composition uses a horizontal masthead, a full-width spatial
scene, an inset booking dock, intent presets and a result with a separate AI
reasoning rail. The floor illustration is original CSS geometry. Reduced-motion
preferences remove nonessential movement; booking controls remain ordinary
labelled form fields.

| Reference consulted | Design direction adapted for this project |
| --- | --- |
| [FoundrSpace Coworking, Awwwards](https://www.awwwards.com/sites/foundrspace-coworking) | Distinct entry points for different space needs; clear actions leading into booking. |
| [The Loft, Awwwards](https://www.awwwards.com/sites/the-loft) | Space-led presentation and prominent navigation into a meeting-room task. |
| [Huts, Lapa Ninja](https://www.lapa.ninja/post/huts/) | An architectural editorial composition with a large spatial focal point. |
| [Photoncycle, Lapa Ninja](https://www.lapa.ninja/post/photoncycle/) | Present a system through a central spatial object and explain the supporting logic. |

The page does not copy those sites' artwork, branding or source code. These
references do not imply an award or endorsement.
