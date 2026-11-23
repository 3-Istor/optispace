# Démonstration locale Facility Manager

Ces scripts PowerShell démarrent OptiSpace sur Windows avec une base SQLite dédiée et un profil Facility Manager de démonstration. Les observations et réservations sont simulées. Le serveur et le frontend écoutent sur `127.0.0.1`, aux ports 5301 et 5300.

Depuis la racine du dépôt, préparer les dépendances une première fois.

```powershell
python -m venv backend/.venv
& ./backend/.venv/Scripts/python.exe -m pip install -r backend/requirements.txt
npm --prefix frontend ci
```

Lancer la démonstration.

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ./scripts/local-demo/Start-OptiSpace.ps1
```

Ouvrir `http://127.0.0.1:5300/admin`. Le chargement initial prépare huit semaines terminées de données simulées. Le tableau de bord propose **Générer la synthèse** pour une salle et **Générer le rapport** pour les salles et horaires choisis, avec téléchargement PDF. Choisir **7 jours** dans la synthèse permet de consulter les observations historiques de la démo.

Le lanceur utilise la clé Gemini configurée par l’environnement ou les fichiers `.env` du backend. À défaut, une saisie masquée enregistre une clé chiffrée pour le compte Windows courant dans `.gemini-key.xml`. Les démarrages suivants rechargent cette valeur. Le serveur doit être lancé depuis ce même compte Windows. Pour remplacer la clé enregistrée, exécuter le script de configuration.

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ./scripts/local-demo/Set-OptiSpaceGemini.ps1
```

Les fichiers de données, journaux et clé chiffrée sont générés à côté des scripts et exclus de Git. Le lanceur annonce son URL lorsqu’il est prêt. Garder le terminal ouvert pendant l’essai. `Ctrl+C` arrête la démonstration.

## Variantes de test

- `-WithoutGemini` utilise les calculs et les règles OptiSpace.
- `-ReferenceCases` charge le jeu simulé IOT-38 dans une base distincte.
- `-SmokeTest` vérifie le cas J-01 sur la route du tableau de bord, puis arrête les serveurs.

Les KPI sont calculés par OptiSpace. Gemini sélectionne les constats et priorise les actions admissibles lorsque la clé et les données le permettent. Les modes de génération et les limites des observations accompagnent les résultats.
