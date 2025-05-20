# Homebridge Unifi Access Plugin

### !! Experimental !!



At the moment, the only thing this plugins does is expose all the Doors in Unifi Access as momentary locks in
homebridge/homekit. The momentary locks enables you to unlock the doors, which will then automatically be locked again
(based on the settings per door in Unifi Access). Due to the nature of Unifi door access, it is not possible
to keep the door unlocked and issue a separate "lock" command to the doors.

### Settings

- `host` (required) - The IP/host of the Unifi Access controller.
- `port` (default: 12445) - The port of the Unifi Access controller API 
- `token` (required) - The API token to access Unifi Access controller. You can create an api in `System > General > API Token`.
- `webhookPort` (optional) - This plugin worked by starting an internal webserver which Unifi calls as event notification
  (such as notifying when a door was unlocked). You can use this setting to define the port of this internal web server. When
  not set, a random available port will be selected internally. You can typically leave this unset and let the system choose
  a free port. The web server will but up and running as long as the plugin is up and running.

