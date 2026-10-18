# Daymark

A responsive to-do list built with HTML, CSS, JavaScript, Firebase Authentication, and Cloud Firestore.

## Connect Firebase

1. Create a Firebase project and register a **Web app** in Project settings.
2. Copy the web app configuration into `firebase-config.js`.
3. In Firebase Console, enable **Authentication → Sign-in method → Anonymous**.
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

   The app signs visitors in anonymously and stores their tasks at `users/{uid}/tasks`.

Do not use publicly writable Firestore rules in a deployed app. Review Firebase's security rules before publishing.

If the app reports `auth/admin-restricted-operation`, Anonymous sign-in is not enabled for the configured Firebase project. Enable it under **Authentication → Sign-in method → Anonymous**, then reload the app.

## Run locally

Serve this folder over HTTP (ES modules do not work reliably from a `file://` URL). For example, with Python installed:

```sh
python -m http.server 8000
```

Then open `http://localhost:8000`.
