I want to create a more detailed scope for a new project. This will be used later to create technical and software architecure documents. This project involves building a platform for open mics, jam/trad sessions, and comedy nights. In this document we use "open-mic" as the generic term for any of these recurring performance events; the specific type is a property of each event series (e.g., open-mic, jam session, trad session, comedy night). The platform should be the:
* go-to place to:
  * find out about regular open mics, sessions, comedy nights, and upcoming events
  * see past events in video and photos
  * contact organizers
  * see profiles and info about musicians, poets, comedians, and other performers
  * meet other musicians, comedians, and bands
* organizers of open mics can manage venues, events, details about their venue, etc. They can manage multiple open-mics in different venues. They can refer to each one as a "session", "open mic", "jam", or "comedy night" depending on its type. In this document we will always use the term "open mic" or "open-mic" as the generic label. Each open-mic should have a schedule, venue, past events, scheduled events, and a type (open-mic, jam session, trad session, comedy night). Organizers of an open mic can change all the details of their own open-mics. They can have multiple open-mics but the tools described below will focus on one at a time and the organizer can switch between open-mics as if they were profiles or accounts.
* public can access web pages to view information about each open-mic with pictures and videos of past events, info about future events, address, map, contacts, etc.
* musicians can manage their own page and content with the ability to (soft) remove links to videos and pictures that they don't like, and display info about themselves and events they have attended at different open-mic venues, add contact and other links, etc.
* musicians can also manage multiple pages, for example for different bands they are a member of as well as their solo work.
* musicians can grant access to content on their pages to other users (for example for band pages)

The project will probably contain multiple related or sub-projects for the following elements:
* A website with desktop and mobile access for all the organizers, musicians, and public can view events, phots, videos, share, like, comment, etc.
* A website where organizers can manage their open-mics and content
* A website where musicians can manage their own content
* A website or mobile app that organizers can use to register performers at events and record the details
* A page where attendee performers can register for an event, register with their email or social media users, or as a guest with just their name. They can do this on a tablet at the event, or if required b the organizer, do it prior to the event

Some initial user story ideas are:

* As an open-mic organizer I can
    * Create a new weekly or monthly open-mic gathering with:
        * schedule
        * venue, address, contacts
        * details, description
        * tags
        * attributes like: orginals only, entry fee, amplification available
        * acts allowed: songs, poetry, stories, others
        * age groups: adults only, children, mixed
        * Do we accept performer registrations before the event or only on the night?
    * Record event information
        * Create event with name, date, location, time
        * Start and end event
        * Tag events with arbitrary labels
        * Group events by tags, etc.
        * add photos and links to YouTube videos
        * allow visitors to react to videos and photos and comment on them and share them with others
    * Manage list of registered performers during event
        * Change order
        * Mark event as done so no one new can register
        * Duplicate details if a performer plays again
        * List songs optionally
        * View past events
        * See photos and videos of performers
    * Gather registrations for an event prior to the event if required
        * we need a registration page for each event for performers to register
    * Gather registrations for an event on the night if allowed
        * I can leave a tablet out where people self-sign up as they come in
        * I can go around an get names and details with my phone or tablet
        * Share a link or QR code to sign up on their own device
        * During registration, guest performers can choose to allow their name, video, photos to be visible on our website
        * It should be clear to registrants that if they sign-up with their email or social media account using Oauth then they will be able to remove individual videos and photos as they wish
* As a musician
    * Manage a profile with photos and videos from open mics hosted by this platform
    * Sign up to take the mic at a specific event
    * Follow a link or QR code to sign up on their phone
    * Link lets you revisit that performance any time
    * As registered user or guest performer
    * Give name, city, contact
    * Encourage them to list the songs they sang
    * Allow musicians to choose if their videos and photos are shared on the website. This is YES by default. They can change it after if they register.  
* As a performer with a registered username
    * See what events I have been at
    * Tag my events, search
    * I can see All my details from that night
    * Some minor edits allowed after event closes (like update song names)
 