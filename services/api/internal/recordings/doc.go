// Package recordings keeps Pro reps' call recordings. A rep turns recording
// on once, agreeing to tell every lead at the start that the call may be
// recorded. The phone provider records each answered call; after the call,
// the worker copies the file into our storage. The rep plays or downloads
// it through links that work for 10 minutes, and can delete it; it is
// deleted on its own after 90 days.
package recordings
