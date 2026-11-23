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

## Vérification AIAD (IOT-86)

Le modèle par défaut est `gemini-3.5-flash-lite`, remplaçable via `GEMINI_MODEL`.
Les essais du 23 novembre 2026 ont rencontré des indisponibilités sur `gemini-3.1-flash-lite`.
Un appel réussi ne garantit ni la disponibilité suivante ni un bénéfice métier.

Le rapport conserve les priorités des règles dans `baseline_recommendations`, les avertissements
de mesure indépendants dans `measurement_warnings`, et une `facts_revision` indépendante
de la sélection IA et de l'heure de génération. `data_revision` identifie toujours l'instantané
complet. L'écran et le PDF expliquent la sélection et son éventuelle différence avec les règles.
Les entrées du modèle excluent noms, équipements, preuves rédigées et événements individuels.

Depuis la racine, avec l'environnement backend installé :

```powershell
& backend/.venv/Scripts/python.exe scripts/local-demo/verify_aiad.py --output output/aiad
& backend/.venv/Scripts/python.exe scripts/local-demo/evaluate_priorities.py --output output/priorities
# Optionnel : la clé configurée est utilisée, sans lecture ni affichage manuel.
& backend/.venv/Scripts/python.exe scripts/local-demo/evaluate_priorities.py --real-gemini --repeats 3 --output output/priorities-real
```

`evaluate_priorities.py` ne lit pas la base et produit les entrées, attentes, empreintes et résultats.
Huit scénarios synthétiques évaluent des critères pilotes rédigés par le développeur : validité,
première priorité admissible et présence des actions requises. Ce protocole ne mesure pas
l'utilité humaine ni toute la qualité du classement. Les pannes et les appels évités restent séparés.
Les appels sont bornés à trois par scénario par défaut, et s'arrêtent après trois échecs consécutifs.

`verify_browser.py --output output/aiad` démarre puis arrête ses propres serveurs 5310/5311.
Il nécessite Playwright et Edge ou Chrome installés dans l'environnement de test.
`--real-gemini` utilise la clé de l'environnement du processus et conserve les statuts réels,
y compris les échecs. Sans ce drapeau, aucun modèle réel n'est appelé.
Il vérifie l'écran, les avertissements, la comparaison, le PDF téléchargé, les données absentes,
les périodes invalides et la largeur mobile. Ne pas l'exécuter sur des données partagées.

Mesure mémoire Windows, dans une base synthétique distincte (environ 800 000 observations) :

```powershell
& backend/.venv/Scripts/python.exe scripts/local-demo/benchmark_report.py --seed --database output/benchmark.sqlite3 --output output/seed.json
& backend/.venv/Scripts/python.exe scripts/local-demo/benchmark_report.py --buffered --database output/benchmark.sqlite3 --output output/memory-before.json
& backend/.venv/Scripts/python.exe scripts/local-demo/benchmark_report.py --database output/benchmark.sqlite3 --output output/memory-after.json
```

Le scénario comporte une salle, 93 jours et un heartbeat toutes les dix secondes. Comparer
`facts_revision` et `totals`, puis la mémoire et la durée. Le pic mémoire du processus Windows
ne remplace pas une mesure du conteneur PostgreSQL sous requêtes concurrentes.

Si `make` est absent sur Windows, les équivalents de `make check` sont :

```powershell
Push-Location backend
& .venv/Scripts/python.exe -m pytest -q
Pop-Location
npm --prefix frontend test
npm --prefix frontend run build
```
