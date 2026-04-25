# Accountant24 Demo #1 — VHS Cassette
# Usage: vhs demo1.tape

Output assets/demo1.mp4

Require a24
Set Shell "zsh"
Set FontSize 20
Set Framerate 60
Set Width 1200
Set Height 800
Set Theme "Catppuccin Mocha"
Set TypingSpeed 40ms
Set Padding 10
Set Margin 20
Set MarginFill "#FFFFFF"
Set BorderRadius 20

# Launch Accountant24

Hide
Type "a24"
Enter
Sleep 2s
Show

# Teach the agent — memory + auto-tagging
Sleep 2s
Type "I'm in Berlin. Remember to tag today's expenses with trip_berlin"
Sleep 500ms
Enter
Sleep 16s

# Start a new session
Type@200ms "/new"
Sleep 2s
Enter
Sleep 2s

# Log expenses — one message, diverse categories, famous places
Type "ICE to Berlin 29.90, BVG day pass 11.20, coffee at The Barn 4.90, Alte Nationalgalerie 14, burger at Burgermeister 5, beers at Klunkerkranich 9, kebab at Mustafa's 7.90, ICE back 29.90"
Sleep 500ms
Enter
Sleep 30s

# Ask a question about spending — demo tag prefill with @
Type "Total for "
Sleep 500ms
Type@200ms "@"
Sleep 1s
Type@200ms "berlin"
Sleep 1s
Down
Sleep 500ms
Enter
Sleep 500ms
Type " by category"
Sleep 500ms
Enter
Sleep 15s
