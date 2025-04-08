import json
from collections import defaultdict

original = '/content/groupes_villes_simplifie_reprojete.geojson'
with open(original, 'r') as f:
  data = json.load(f)
data
# IA utilisée pour le code suivant : deepseek
# créer un dictionnaire pour regrouper les groupes par ville
ville_groupes = defaultdict(list)

for feature in data['features']:
    nom_ville = feature['properties']['NOM']
    groupe_info = {
        'nom': feature['properties']['nom_groupe'],
        'tags': feature['properties']['tags'],
        'annee': feature['properties']['begin_date_year']
    }
    ville_groupes[nom_ville].append(groupe_info)
ville_groupes

# créer un nouveau GeoJSON avec une entrée par ville
new_features = []
villes_traitees = set()

for feature in data['features']:
    nom_ville = feature['properties']['NOM']
    if nom_ville not in villes_traitees:
        new_feature = {
            'type': 'Feature',
            'properties': {
                'NOM': nom_ville,
                'INSEE_COM': feature['properties']['INSEE_COM'],
                'STATUT': feature['properties']['STATUT'],
                'POPULATION': feature['properties']['POPULATION'],
                'groupes': ville_groupes[nom_ville]
            },
            'geometry': feature['geometry']
        }
        new_features.append(new_feature)
        villes_traitees.add(nom_ville)

new_geojson = {
    'type': 'FeatureCollection',
    'features': new_features
}

# Sauvegarder le nouveau GeoJSON
with open('villes_avec_groupes.geojson', 'w') as f:
    json.dump(new_geojson, f, ensure_ascii=False)