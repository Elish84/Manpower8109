8109 – ניהול כוח אדם – V2

מבנה DB חדש:
forces/{forceId}/soldiers/{soldierId}
(forceId באנגלית, למשל pluga_a)

הפעלה:
1) Firebase Auth -> Enable Anonymous
2) Firestore Rules -> הדבק firestore.rules ו-Publish
3) העלה את כל הקבצים ל-root של הריפו (GitHub Pages)

מיגרציה:
התחבר לכוח ולחץ "הרץ מיגרציה" כדי להעתיק מ-units_*_soldiers למבנה החדש.
אחרי שסיימת, מומלץ להסיר Legacy מה-Rules.
