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
Set TypingSpeed 50ms
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
Type "I'm in Berlin. Tag everything from yesterday through tomorrow as trip_berlin_2026"
Sleep 500ms
Enter
Sleep 20s

# Start a new session
#Type "/new"
#Sleep 2s
#Enter
#Sleep 2s

# Log multiple transactions in one message
Type "Yesterday: Thalys Paris-Berlin 59.90, hotel Adina Mitte 129, dinner at Mustafa's Gemüse Kebap 12.50, Today: Museum Island 19, lunch at Curry 36 8.50, Thalys Berlin-Paris 59.90"
Sleep 500ms
Enter
Sleep 25s

# Start a new session
#Type "/new"
#Sleep 2s
#Enter
#Sleep 2s

# Ask a question about spending — demo tag prefill with @
Type "How much did I spend on "
Sleep 500ms
Type "@"
Sleep 1s
Type "berlin"
Sleep 1s
Down
Sleep 500ms
Enter
Sleep 500ms
Enter
Sleep 20s
