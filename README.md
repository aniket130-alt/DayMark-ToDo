# Daymark

A responsive to-do list built with HTML, CSS, JavaScript, Firebase Authentication, and Cloud Firestore. It includes priorities, categories, due dates, browser reminders, daily progress, dark mode, drag-and-drop ordering, search, completion feedback, and Google account linking.

## Connect Firebase

1. Create a Firebase project and register a **Web app** in Project settings.
2. Copy the web app configuration into `firebase-config.js`.
3. In Firebase Console, enable **Authentication → Sign-in method → Anonymous** and **Google**.
4. Create a **Cloud Firestore** database.
5. Add Firestore security rules that restrict each signed-in user to their own `users/{userId}/tasks` documents. For example:

   ```text
   rules_version = '2';
   service cloud.firestore {
     match /databases/{database}/documents {
       match /users/{userId}/tasks/{taskId} {
         allow read, write: if request.auth != null && request.auth.uid == userId;
       }
     }
   }
   ```

   The app signs visitors in anonymously and stores their tasks at `users/{uid}/tasks`. When a visitor links Google, their anonymous tasks stay under the same user ID. If they sign into a Google account that already exists, the app copies their anonymous tasks into that account; the originals are left in place.

Do not use publicly writable Firestore rules in a deployed app. Review Firebase's security rules before publishing.

If the app reports `auth/admin-restricted-operation`, Anonymous sign-in is not enabled for the configured Firebase project. Enable it under **Authentication → Sign-in method → Anonymous**, then reload the app.

For Google sign-in, enable the Google provider and add the app's hostname under **Authentication → Settings → Authorized domains**. `localhost` is normally authorized for local development.

## Features and notes

- Tasks support high, medium, and low priority, plus Personal, Work, and Study categories.
- Due dates show overdue and due-today badges. The daily progress bar counts tasks due today.
- Set both a due date and reminder time to request a browser notification. Reminders run only while the app is open in that browser; notification permission is required.
- Dark mode is remembered in the current browser.
- Task order syncs through Firestore. On phones, use the up/down controls; on desktop, drag tasks to reorder.
- Search and category/status filters run on the current task list.
- Google account linking makes tasks available on other devices after signing in with that Google account.

## Run locally

Serve this folder over HTTP (ES modules do not work reliably from a `file://` URL). For example, with Python installed:

```sh
python -m http.server 8000
```

Then open `http://localhost:8000`.
