# 
text editing is still broken
this is the fundamental flaw of the app as of now



# upload
uploading a large file returns:
"Upload failed: NetworkError when attempting to fetch resource."
i don't know what fetch resource means?
explain this one

can we get a better error message?


count and report how many files were uploaded successfully instead of just "Upload complete"


# host info
the json seems url encoded (double slashes)
can we try unencoding either the whole json or each element so it looks right?


# key binds
have escape key exit modal windows, like how tapping outside the dialog does


# styling
host, HW scrollbar sometimes is not matching the (default) dark colour scheme. (especially on Chrome)
unsure how to phrase this. need to test more browsers.



# files
show count of the number of files in the header

file extension is cut off
put the file extension (lowercased) as text in the top left of the file icon
(how to handle extensionless filesnames?)


gives previews of file contents. for example txt, pdf, 
probably better to look at file contents to determine type rather than trusting extension
can the browser gives hints when file uploading by mime typing?


i feel like i want a classic vertical "index of" file list but more detailed and still with previews


# versioning
mirror the goboard file versinoing
0.1.0 is a template value


# resources
embedding resources in a win32 rust binary
strings, icons, RC_DATA


# app authorship
embed who authored the app
compiler instanced values


# dark mode UI
implement both dark and light mode




# keymap
Base Keymap
VS Code
Atom
JetBrains
Emacs
Sublime Text
Cursor







