/********************************************************************
 *  SYSTEME D'ONGLETS + REGISTRE GENERIQUE DE CARTES
 ********************************************************************/

// Registre contenant toutes les cartes de la page
const mapRegistry = {
  "carte-son": {
    initialized: false,
    initFunction: initCarteSon,
    map: null
  },
  "carte-tsunami": {
    initialized: false,
    initFunction: initCarteTsunami,
    map: null
  },
  "carte-evolution": {
    initialized: false,
    initFunction: initCarteEvolution,
    map: null
  },
  "presentation": {
  initialized: false,
  initFunction: initPresentation,
  map: null
  },
  "carte-deces": {
    initialized: false,
    initFunction: initCarteDeces,
    map: null
  },
  "avant-apres": {
  initialized: false,
  initFunction: initAvantApres,
  map: null
  }
};

// Gestion dynamique des onglets
document.querySelectorAll('#tabs li').forEach(tab => {
  tab.addEventListener('click', () => {

    const id = tab.dataset.tab;

    // Sélection visuelle des onglets
    document.querySelectorAll('#tabs li').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');

    // Affichage de l'onglet actif
    document.querySelectorAll('.tab').forEach(div => div.classList.remove('active'));
    document.getElementById(id).classList.add('active');

    // Si cet onglet gère une carte
    if (mapRegistry[id]) {
      const entry = mapRegistry[id];

      // Lancer l'initialisation uniquement à la première ouverture
      if (!entry.initialized) {
        entry.initFunction();
        entry.initialized = true;
      }

      // Resize léger pour forcer MapLibre à se recalculer correctement
      setTimeout(() => {
        if (entry.map) entry.map.resize();
      }, 150);
    }
  });
});

/********************************************************************
 *  CARTE SON
 ********************************************************************/

// ----------------------
// Constantes physiques
// ----------------------
const son_VITESSE_SON_M_S = 340;
const son_PAS_MINUTES = 1;
const son_TOTAL_DUREE_MINUTES = 240;
const son_SECONDS_PER_MINUTE = 60;
const son_EARTH_RADIUS_M = 6371008.8;

// ----------------------
// Fonctions géodésiques
// ----------------------
function son_haversineDistanceMeters(a, b) {
  const toRad = d => d * Math.PI / 180;
  const lon1 = toRad(a[0]), lat1 = toRad(a[1]);
  const lon2 = toRad(b[0]), lat2 = toRad(b[1]);
  const dlon = lon2 - lon1, dlat = lat2 - lat1;

  const h = Math.sin(dlat / 2) ** 2 +
            Math.cos(lat1) * Math.cos(lat2) * Math.sin(dlon / 2) ** 2;

  return 2 * son_EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

function son_destinationPoint(lonLat, distanceM, bearingDeg) {
  const φ1 = lonLat[1] * Math.PI / 180;
  const λ1 = lonLat[0] * Math.PI / 180;
  const θ = bearingDeg * Math.PI / 180;
  const δ = distanceM / son_EARTH_RADIUS_M;

  const sinφ1 = Math.sin(φ1), cosφ1 = Math.cos(φ1);
  const sinδ = Math.sin(δ), cosδ = Math.cos(δ);

  const sinφ2 = sinφ1 * cosδ + cosφ1 * sinδ * Math.cos(θ);
  const φ2 = Math.asin(sinφ2);

  const y = Math.sin(θ) * sinδ * cosφ1;
  const x = cosδ - sinφ1 * sinφ2;

  const λ2 = λ1 + Math.atan2(y, x);

  return [
    (λ2 * 180 / Math.PI + 540) % 360 - 180,
    φ2 * 180 / Math.PI
  ];
}

function son_createGeodesicCircle(centerLonLat, radiusMeters, steps = 128) {
  const coords = [];

  for (let i = 0; i <= steps; i++) {
    const bearing = (i / steps) * 360;
    coords.push(son_destinationPoint(centerLonLat, radiusMeters, bearing));
  }

  return {
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      properties: { radius_m: radiusMeters },
      geometry: {
        type: 'Polygon',
        coordinates: [coords]
      }
    }]
  };
}

function son_rayonAuPas(pasMinutes) {
  return son_VITESSE_SON_M_S * pasMinutes * son_SECONDS_PER_MINUTE;
}

// ----------------------
// Initialisation Carte SON
// ----------------------
function initCarteSon() {

  // DOM
  const slider = document.getElementById('time-slider');
  const label = document.getElementById('time-label');

  slider.min = 0;
  slider.max = son_TOTAL_DUREE_MINUTES;
  slider.step = 1;
  slider.value = 0;

  // Ajout boutons Play/Pause
  const controlsContainer = document.createElement('div');
  controlsContainer.style.marginTop = '10px';
  controlsContainer.style.textAlign = 'center';

  const playButton = document.createElement('button');
  playButton.textContent = '▶️';
  playButton.style.marginRight = '10px';
  playButton.style.fontSize = '1.2em';

  const pauseButton = document.createElement('button');
  pauseButton.textContent = '⏸️';
  pauseButton.style.fontSize = '1.2em';
  pauseButton.disabled = true;

  controlsContainer.appendChild(playButton);
  controlsContainer.appendChild(pauseButton);
  slider.parentNode.appendChild(controlsContainer);

  // Map
  const map = new maplibregl.Map({
    container: 'map',
    style: 'https://tiles.openfreemap.org/styles/liberty',
    center: [105.423, -6.102],
    zoom: 10
  });

  mapRegistry["carte-son"].map = map;

  let krakatoa, lieux, polygone;
  let autoplayInterval = null;

  async function loadData() {
    krakatoa = await fetch('geojson/LOCALISATION_KRAKATOA_WGS84.geojson').then(r => r.json());
    lieux = await fetch('geojson/LIEUX_SON_ENTENDU_WGS84.geojson').then(r => r.json());
    polygone = await fetch('geojson/POLYGONE_SON_ENTENDU_WGS84.geojson').then(r => r.json());

    const center = krakatoa.features[0].geometry.coordinates;

    // Distances précalculées
    lieux.features = lieux.features.map(f => {
      return {
        ...f,
        properties: {
          ...f.properties,
          dist_m: Math.round(son_haversineDistanceMeters(center, f.geometry.coordinates))
        }
      };
    });

    map.on('load', () => {

      map.addSource('son_krakatoa', { type: 'geojson', data: krakatoa });
      map.addLayer({
        id: 'son_krakatoa-point',
        type: 'circle',
        source: 'son_krakatoa',
        paint: {
          'circle-radius': 8,
          'circle-color': '#d91e18',
          'circle-stroke-color': '#fff',
          'circle-stroke-width': 1.5
        }
      });

      map.addSource('son_lieux', { type: 'geojson', data: lieux });
      map.addLayer({
        id: 'son_lieux-points',
        type: 'circle',
        source: 'son_lieux',
        paint: {
          'circle-radius': 5,
          'circle-color': '#1967d2',
          'circle-opacity': 0.85,
          'circle-stroke-color': '#fff',
          'circle-stroke-width': 1
        }
      });

      map.addLayer({
        id: 'son_lieux-labels',
        type: 'symbol',
        source: 'son_lieux',
        layout: {
          'text-field': ['get', 'desc'],
          'text-size': 11,
          'text-offset': [0, 1.2]
        },
        paint: {
          'text-color': '#333',
          'text-halo-color': '#fff',
          'text-halo-width': 0.8
        }
      });

      map.addSource('son_zone', { type: 'geojson', data: polygone });
      map.addLayer({
        id: 'son_zone-fill',
        type: 'fill',
        source: 'son_zone',
        paint: {
          'fill-color': '#b0bec5',
          'fill-opacity': 0.15
        }
      });

      map.addSource('son_cercle', {
        type: 'geojson',
        data: son_createGeodesicCircle(center, 0)
      });

      map.addLayer({
        id: 'son_cercle-line',
        type: 'line',
        source: 'son_cercle',
        paint: {
          'line-color': '#ff8f00',
          'line-width': 2.5
        }
      });

      applyStep(0);
    });

    // Popup
    const popup = new maplibregl.Popup({ closeButton: false, closeOnClick: false });

    map.on('mouseenter', 'son_lieux-points', e => {
      map.getCanvas().style.cursor = 'pointer';
      const f = e.features[0];
      const coords = f.geometry.coordinates.slice();
      popup.setLngLat(coords)
        .setHTML(`<strong>${f.properties.lieu}</strong><br>${f.properties.desc}`)
        .addTo(map);
    });

    map.on('mouseleave', 'son_lieux-points', () => {
      map.getCanvas().style.cursor = '';
      popup.remove();
    });
  }

  function applyStep(pas) {
    const radius = son_rayonAuPas(pas);
    label.textContent = `${pas} min (rayon: ${(radius / 1000).toFixed(0)} km)`;

    const center = krakatoa.features[0].geometry.coordinates;

    map.getSource('son_cercle')
      .setData(son_createGeodesicCircle(center, radius));

    const expr = ['<=', ['get', 'dist_m'], radius];
    map.setFilter('son_lieux-points', expr);
    map.setFilter('son_lieux-labels', expr);

    const km = radius / 1000;
    let zoom = 14.5 - Math.log2(km + 1);
    zoom = Math.max(Math.min(zoom, 10), 2);

    map.easeTo({
      center,
      zoom,
      duration: 600
    });
  }

  loadData();

  // Slider
  slider.addEventListener('input', e => {
    const v = parseInt(e.target.value, 10);
    applyStep(v);
  });

  // Autoplay
  playButton.addEventListener('click', () => {
    if (autoplayInterval) return;

    playButton.disabled = true;
    pauseButton.disabled = false;

    autoplayInterval = setInterval(() => {
      let v = parseInt(slider.value, 10);
      if (v >= son_TOTAL_DUREE_MINUTES) {
        clearInterval(autoplayInterval);
        autoplayInterval = null;
        playButton.disabled = false;
        pauseButton.disabled = true;
        return;
      }
      slider.value = ++v;
      applyStep(v);
    }, 200);
  });

  pauseButton.addEventListener('click', () => {
    if (!autoplayInterval) return;

    clearInterval(autoplayInterval);
    autoplayInterval = null;

    playButton.disabled = false;
    pauseButton.disabled = true;
  });
}

/********************************************************************
 *  CARTE TSUNAMI
 ********************************************************************/
function initCarteTsunami() {

  const map = new maplibregl.Map({
    container: 'tsunami-map',
    style: 'https://tiles.openfreemap.org/styles/liberty',
    center: [105.423, -6.102],
    zoom: 8
  });

  mapRegistry["carte-tsunami"].map = map;

  map.addControl(new maplibregl.NavigationControl());

  map.on('load', async () => {

    const zones = await fetch('geojson/ZONES_SUBMERGEES_TSUNAMI_WGS84.geojson').then(r => r.json());
    const zonesVerbeek = await fetch('geojson/ZONES_SUBMERGEES_TSUNAMI_VERBEEK_WGS84.geojson').then(r => r.json());
    const krakatoa = await fetch('geojson/LOCALISATION_KRAKATOA_WGS84.geojson').then(r => r.json());

    map.addSource('tsunami_krakatoa', { type: 'geojson', data: krakatoa });
    map.addLayer({
      id: 'tsunami_krakatoa-point',
      type: 'circle',
      source: 'tsunami_krakatoa',
      paint: {
        'circle-radius': 8,
        'circle-color': '#d91e18',
        'circle-stroke-color': '#fff',
        'circle-stroke-width': 1.5
      }
    });

    map.addSource('tsunami_zones_verbeek', { type: 'geojson', data: zonesVerbeek });
    map.addLayer({
      id: 'tsunami_zones-verbeek-fill',
      type: 'fill',
      source: 'tsunami_zones_verbeek',
      paint: {
        'fill-color': '#ff5e00ff',
        'fill-opacity': 0.4
      }
    });

    map.addSource('tsunami_zones', { type: 'geojson', data: zones });
    map.addLayer({
      id: 'tsunami_zones-fill',
      type: 'fill',
      source: 'tsunami_zones',
      paint: {
        'fill-color': '#1E90FF',
        'fill-opacity': 0.45
      }
    });

  });
}

/********************************************************************
 *  CARTE ÉVOLUTION (2017–2021)
 ********************************************************************/
function initCarteEvolution() {

  const evo_annees = [2017, 2018, 2019, 2020, 2021];

  const evo_coords = [
    [105.36, -6.11], // haut gauche
    [105.50, -6.11], // haut droit
    [105.50, -6.25], // bas droit
    [105.36, -6.25]  // bas gauche
  ];

  const evo_slider = document.getElementById("timeline");
  const evo_anneeAffichee = document.getElementById("anneeAffichee");

  // Boutons Play / Pause
  const controlsContainer = document.createElement('div');
  controlsContainer.style.marginTop = '10px';
  controlsContainer.style.textAlign = 'center';

  const playButton = document.createElement('button');
  playButton.textContent = '▶️';
  playButton.style.marginRight = '10px';
  playButton.style.fontSize = '1.2em';

  const pauseButton = document.createElement('button');
  pauseButton.textContent = '⏸️';
  pauseButton.style.fontSize = '1.2em';
  pauseButton.disabled = true;

  controlsContainer.appendChild(playButton);
  controlsContainer.appendChild(pauseButton);

  // Insertion sous le slider
  evo_slider.parentNode.appendChild(controlsContainer);


  evo_slider.min = 1;
  evo_slider.max = evo_annees.length;
  evo_slider.value = 1;
  evo_anneeAffichee.textContent = evo_annees[0];

  const evo_map = new maplibregl.Map({
    container: 'evolution-map',
    center: [105.43, -6.18],
    zoom: 11,
    style: {
      version: 8,
      sources: {
        evo_satellite: {
          type: 'raster',
          tiles: [
            'https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2020_3857/default/g/{z}/{y}/{x}.jpg'
          ],
          tileSize: 256
        }
      },
      layers: [
        {
          id: 'evo_satellite',
          type: 'raster',
          source: 'evo_satellite'
        }
      ]
    }
  });

  mapRegistry["carte-evolution"].map = evo_map;

  evo_map.on('load', () => {

    evo_annees.forEach((annee, i) => {

      evo_map.addSource(`evo_classif_${annee}`, {
        type: 'image',
        url: `img/${annee}.png`,
        coordinates: evo_coords
      });

      evo_map.addLayer({
        id: `evo_classif_${annee}`,
        type: 'raster',
        source: `evo_classif_${annee}`,
        paint: {
          'raster-opacity': i === 0 ? 1 : 0
        }
      });
    });

  });
    /* Autoplay */
    evo_slider.addEventListener("input", () => {

      const index = parseInt(evo_slider.value, 10) - 1;

      evo_annees.forEach((annee, i) => {
        evo_map.setPaintProperty(
          `evo_classif_${annee}`,
          'raster-opacity',
          i === index ? 1 : 0
        );
      });

      evo_anneeAffichee.textContent = evo_annees[index];
    });

    let autoplayInterval = null;

  playButton.addEventListener('click', () => {
    if (autoplayInterval) return;

    playButton.disabled = true;
    pauseButton.disabled = false;

    autoplayInterval = setInterval(() => {
      let v = parseInt(evo_slider.value, 10);

      if (v >= evo_annees.length) {
        clearInterval(autoplayInterval);
        autoplayInterval = null;
        playButton.disabled = false;
        pauseButton.disabled = true;
        return;
      }

      evo_slider.value = v + 1;
      evo_slider.dispatchEvent(new Event('input'));
    }, 800);
  });

  pauseButton.addEventListener('click', () => {
    if (!autoplayInterval) return;

    clearInterval(autoplayInterval);
    autoplayInterval = null;

    playButton.disabled = false;
    pauseButton.disabled = true;
  });

}

/********************************************************************
 *  PRESENTATION : Globe + Diaporama
 ********************************************************************/
function initPresentation() {

  /* ========= GLOBE ========= */

  const geojsonVolcan = {
    type: "FeatureCollection",
    features: [{
      type: "Feature",
      geometry: {
        type: "Point",
        coordinates: [105.42403, -6.10020]
      }
    }]
  };

  const map = new maplibregl.Map({
    container: 'presentation-map',
    center: [105.42403, -6.10020],
    zoom: 1,
    style: {
      version: 8,
      projection: { type: 'globe' },
      sources: {
        satellite: {
          type: 'raster',
          tiles: [
            'https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2020_3857/default/g/{z}/{y}/{x}.jpg'
          ],
          tileSize: 256
        }
      },
      layers: [{
        id: 'satellite',
        type: 'raster',
        source: 'satellite'
      }]
    }
  });

  mapRegistry.presentation.map = map;

  map.on('load', () => {
    map.addSource('volcan', { type: 'geojson', data: geojsonVolcan });

    map.addLayer({
      id: 'volcan-point',
      type: 'circle',
      source: 'volcan',
      paint: {
        'circle-radius': 7,
        'circle-color': '#d91e18',
        'circle-stroke-color': '#fff',
        'circle-stroke-width': 1.5
      }
    });

    map.easeTo({
      center: [105.42403, -6.10020],
      zoom: 8,
      duration: 5000
    });
  });

  /* ========= DIAPORAMA ========= */

  let slideIndex = 1;
  const slides = document.querySelectorAll('.mySlide');
  const dots = document.querySelectorAll('.dot');
  const prev = document.querySelector('.prev');
  const next = document.querySelector('.next');

  function showSlide(n) {
    if (n > slides.length) slideIndex = 1;
    if (n < 1) slideIndex = slides.length;

    slides.forEach(s => s.style.display = 'none');
    dots.forEach(d => d.classList.remove('active'));

    slides[slideIndex - 1].style.display = 'block';
    dots[slideIndex - 1].classList.add('active');
  }

  showSlide(slideIndex);

  prev.addEventListener('click', () => showSlide(--slideIndex));
  next.addEventListener('click', () => showSlide(++slideIndex));

  dots.forEach(dot => {
    dot.addEventListener('click', () => {
      slideIndex = parseInt(dot.dataset.slide, 10);
      showSlide(slideIndex);
    });
  });
}

/********************************************************************
 *  CARTE DÉCÈS
 ********************************************************************/
async function initCarteDeces() {

  /* === 1. Chargement des données GeoJSON === */
  const myGeojson = await fetch('geojson/NB_MORTS_PAR_REGION_WGS84.geojson').then(r => r.json());

  const Villages_2 = await fetch('geojson/NB_MORTS_PAR_VILLAGE_WGS84.geojson').then(r => r.json());

  /* === 2. Initialisation de la carte === */
  const map_deces = new maplibregl.Map({
    container: 'map_deces',
    zoom: 0,
    center: [137.9150899566626, 36.25956997955441],
    style: {
      version: 8,
      projection: { type: 'globe' },
      sources: {
        satellite: {
          type: 'raster',
          tiles: [
            'https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2020_3857/default/g/{z}/{y}/{x}.jpg'
          ],
          tileSize: 256
        }
      },
      layers: [{
        id: 'Satellite',
        type: 'raster',
        source: 'satellite'
      }]
    }
  });

  mapRegistry["carte-deces"].map = map_deces;

  //-------------------------------------------------------------------
  // DISTRICTS 
  //-------------------------------------------------------------------

  map_deces.on('load', () => {
      
      let currentFilterMode = 'ALL'; 

      const features = myGeojson.features.filter(f => f.properties.Nbr_morts > 1);
      const activeDistrictNames = [...new Set(features.map(f => f.properties.shapeName))];

      const allDistrictsGeojsonForBorders = myGeojson;
      const allDistrictsGeojsonForFill = myGeojson;

      let groupedDistricts = {};
      for (let feat of features) {
          const districtName = feat.properties.shapeName; 
          if (!groupedDistricts[districtName]) {
              groupedDistricts[districtName] = {
                  Nbr_morts: feat.properties.Nbr_morts, 
                  polygons: []
              };
          }
          groupedDistricts[districtName].polygons.push(feat);
      }
      
      let districtsArray = Object.values(groupedDistricts).map(data => {
          const featureCollection = turf.featureCollection(data.polygons);
          return {
              ...data,
              bounds: turf.bbox(featureCollection) 
          };
      });
      
      districtsArray.sort((a, b) => a.Nbr_morts - b.Nbr_morts);

      let animatedGeojson = {
          type: "FeatureCollection",
          features: []
      };

      // --- Récupération des noms de districts pour le sélecteur (Nbr_morts > 1) ---
      const allUniqueDistrictNames = activeDistrictNames.sort();

      // Source statique pour toutes les bordures 
      map_deces.addSource('Borders_Complet_SansFiltre', {
          type: 'geojson',
          data: allDistrictsGeojsonForBorders
      });
      
      map_deces.addSource('All_Districts_Complet', {
          type: 'geojson',
          data: allDistrictsGeojsonForFill
      });

      map_deces.addLayer({
          id: 'Districts_fill_static',
          type: 'fill',
          source: 'All_Districts_Complet', 
          paint: {
              'fill-color': [
                  'step',
                  ['get', 'Nbr_morts'],
                  '#FFFF', 0, 
          '#f9e1cbff', 10, 
          '#F88D63', 500, 
          '#F44D08',5000, 
          '#C83F09', 15000, 
          '#ae2a1bff', 20000, 
          '#7d1813ff'
              ],
              'fill-opacity': 0.7 
          },
          filter: ['>', ['get', 'Nbr_morts'], 1]
      });
      
      // Couche de bordures statiques toujours visible 
      map_deces.addLayer({
          id: 'borders_all_static',
          type: 'line',
          source: 'Borders_Complet_SansFiltre', 
          paint: {
              'line-color': '#CCCCCC', 
              'line-width': 0.8
          },
          layout: { 'visibility': 'visible' } 
      });

      map_deces.addSource('Districts_anim', {
          type: 'geojson',
          data: animatedGeojson
      });

      map_deces.addLayer({
          id: 'Nbr_morts_anim',
          type: 'fill',
          source: 'Districts_anim',
          paint: {
              'fill-color': [
                  'step',
                  ['get', 'Nbr_morts'],
                  '#FFFF', 0, '#f9e1cbff', 10, '#F88D63', 500, '#F44D08',
                  5000, '#C83F09', 15000, '#ae2a1bff', 20000, '#7d1813ff'
              ],
              'fill-opacity': 0.7
          },
          layout: { 'visibility': 'none' } 
      });

      map_deces.addLayer({
          id: 'borders_anim',
          type: 'line',
          source: 'Districts_anim',
          paint: {
              'line-color': '#ffffff', 
              'line-width': 1.2
          },
          layout: { 'visibility': 'none' } 
      });


      //-------------------------------------------------------------------
      // 5) Etiquettes 
      //-------------------------------------------------------------------

      let aggregatedDistricts = {};
      for (let feat of features) {
          const districtName = feat.properties.shapeName; 
          const nbrMorts = feat.properties.Nbr_morts;
          if (!aggregatedDistricts[districtName]) { aggregatedDistricts[districtName] = { nbrMortsValue: nbrMorts, features: [] }; }
          aggregatedDistricts[districtName].nbrMortsValue = nbrMorts;
          aggregatedDistricts[districtName].features.push(feat);
      }

      let labelFeatures = [];
      for (const districtName in aggregatedDistricts) {
          const data = aggregatedDistricts[districtName];
          const featureCollection = turf.featureCollection(data.features);
          const center = turf.centroid(featureCollection); 
          labelFeatures.push({
              type: "Feature",
              geometry: center.geometry,
              properties: {
                  Nbr_morts: data.nbrMortsValue, 
                  District: districtName 
              }
          });
      }

      map_deces.addSource('Districts_labels', {
          type: 'geojson',
          data: { type: "FeatureCollection", features: labelFeatures }
      });

      map_deces.addLayer({
          id: 'labels_morts_anim',
          type: 'symbol',
          source: 'Districts_labels',
          layout: {
              'text-field': ['to-string', ['get', 'Nbr_morts']], 
              'text-size': 12,
              'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold'],
              'text-allow-overlap': true,
              'visibility': 'none'
          },
          paint: {
              'text-color': '#ffffff',
              'text-halo-color': '#000000',
              'text-halo-width': 0.7
          }
      });

      //-------------------------------------------------------------------
      // 6) VILLAGES
      //-------------------------------------------------------------------

      const villagesWithIndex = {
          ...Villages_2,
          features: Villages_2.features.map((f, i) => ({
              ...f,
              properties: {
                  ...f.properties,
                  _village_index: Number(f.properties.raw !== undefined ? f.properties.raw : i) 
              }
          }))
      };
      
      map_deces.addSource('Villages_Source_Complet', {
          type: 'geojson',
          data: villagesWithIndex 
      });

      map_deces.addLayer({
          id: 'Villages_2_anim', 
          type: 'circle',
          source: 'Villages_Source_Complet', 
          filter: ['==', ['get', 'shapeName'], ''], 
          paint: {
              'circle-radius': 4,
              'circle-color': '#4bd1e6ff',
              'circle-opacity': 0.8,
              'circle-stroke-color': '#000000',
              'circle-stroke-width': 0.5
          },
          layout: { 
              'visibility': 'none'
          }
      });

      //-------------------------------------------------------------------
      // 7) ANIMATION
      //-------------------------------------------------------------------

      const POLYGON_DELAY = 500; 
      const VILLAGE_DELAY = 200;
      const FINAL_VILLAGE_DELAY = 250; 
      const ZOOM_DURATION = 2000; 
      const ZOOM_PADDING = 50; 
      let districtIndex = 0;
      
      let displayedVillagesDistricts = []; 
      let maxVillageIndexDisplayed = -1; // Utilisé SEULEMENT pendant l'animation
  
      function toggleAnimationLayers(visible) {
          const visibility = visible ? 'visible' : 'none';
          
          // Rendre la couche de remplissage statique INVISIBLE pendant l'animation
          map_deces.setLayoutProperty('Districts_fill_static', 'visibility', visible ? 'none' : 'visible');
          // borders_all_static N'EST PAS GÉRÉ (il reste visible).

          // Rendre les couches d'animation VISIBLES/INVISIBLES
          map_deces.setLayoutProperty('Nbr_morts_anim', 'visibility', visibility);
          map_deces.setLayoutProperty('borders_anim', 'visibility', visibility);
          map_deces.setLayoutProperty('labels_morts_anim', 'visibility', visibility);
      }
      
      // ANIME LE DISTRICT ACTUEL
      function animateDistrictPolygons(districtData) {
          return new Promise(resolve => {
              let polygonIndex = 0;
              const totalPolygons = districtData.polygons.length;

              function addNextPolygon() {
                  if (polygonIndex < totalPolygons) {
                      
                      animatedGeojson.features.push(districtData.polygons[polygonIndex]);
                      map_deces.getSource('Districts_anim').setData(animatedGeojson);
                      polygonIndex++;

                      setTimeout(addNextPolygon, POLYGON_DELAY);
                  } else {
                      resolve(); 
                  }
              }
              addNextPolygon();
          });
      }

      // ANIME LE CHANGEMENT DE DISTRICTS
      function animateVillagesInDistrict(districtName) {
          return new Promise(resolve => {
              
              const villagesInDistrict = villagesWithIndex.features.filter(
                  f => f.properties.shapeName === districtName
              ).sort((a, b) => a.properties._village_index - b.properties._village_index);
              
              let villageCount = 0;
              const totalVillages = villagesInDistrict.length;
              
              if (!displayedVillagesDistricts.includes(districtName)) {
                  displayedVillagesDistricts.push(districtName);
              }
              
              if (totalVillages === 0) {
                  return resolve(); 
              }
              
              function addNextVillage() {
                  if (villageCount < totalVillages) {
                      
                      const currentVillageIndex = villagesInDistrict[villageCount].properties._village_index;
                      
                      if (currentVillageIndex > maxVillageIndexDisplayed) {
                          maxVillageIndexDisplayed = currentVillageIndex;
                      }
                      const finalFilter = ['<=', ['get', '_village_index'], maxVillageIndexDisplayed];

                      map_deces.setFilter('Villages_2_anim', finalFilter);
                      
                      villageCount++;

                      setTimeout(addNextVillage, VILLAGE_DELAY);
                  } else {
                      resolve(); 
                  }
              }      
              addNextVillage();
          });
      }

      // AFFICHE TOUS LES VILLAGES
      function animateAllRemainingVillagesSequentially() {
          return new Promise(resolve => {
              
              const remainingVillages = villagesWithIndex.features
                  .filter(f => f.properties._village_index > maxVillageIndexDisplayed)
                  .sort((a, b) => a.properties._village_index - b.properties._village_index);

              let villageCount = 0;
              const totalRemaining = remainingVillages.length;
              
              if (totalRemaining === 0) {
                  return resolve(); 
              }
              
              function addNextVillageFinal() {
                  if (villageCount < totalRemaining) {
                      const currentVillageIndex = remainingVillages[villageCount].properties._village_index;
                      if (currentVillageIndex > maxVillageIndexDisplayed) {
                          maxVillageIndexDisplayed = currentVillageIndex;
                      }
                      const finalFilter = ['<=', ['get', '_village_index'], maxVillageIndexDisplayed];

                      map_deces.setFilter('Villages_2_anim', finalFilter);
                      villageCount++;
                      setTimeout(addNextVillageFinal, FINAL_VILLAGE_DELAY);
                  } else {
                      resolve(); 
                  }
              }
              addNextVillageFinal();
          });
      }

      async function animateNextDistrict() {
          if (districtIndex === 0) {
              toggleAnimationLayers(true);
              map_deces.setLayoutProperty('Villages_2_anim', 'visibility', 'visible');
          }
          
          if (districtIndex < districtsArray.length) {
              
              const currentDistrict = districtsArray[districtIndex];
              const districtName = currentDistrict.polygons[0].properties.shapeName; 
              
              // 1. ZOOM
              await new Promise(resolve => {
                  map_deces.fitBounds(currentDistrict.bounds, { padding: ZOOM_PADDING, duration: ZOOM_DURATION, essential: true });
                  map_deces.once('moveend', resolve); 
              });

              // 2. Animer les polygones
              await animateDistrictPolygons(currentDistrict);

              // 3. Animer les villages 
              await animateVillagesInDistrict(districtName);

              // 4. Passer au district suivant
              districtIndex++;
              animateNextDistrict();

          } else {
              // Animation des districts terminée
              await new Promise(resolve => {
                  map_deces.zoomTo(7, {center: [105.424034990009631, -6.100204269531697] });
                  map_deces.once('moveend', resolve); 
              });
              await animateAllRemainingVillagesSequentially();

              console.log("--- Animation séquentielle terminée ---");
              toggleAnimationLayers(false);
              
              // Appliquer l'état final de la carte avec le mode "ALL"
              filterMapByDistrict('ALL'); 
          }
      }


      //-------------------------------------------------------------------
      // 8) SELECTEUR
      //-------------------------------------------------------------------

      const selectElement = document.getElementById('district-select');
      allUniqueDistrictNames.forEach(name => {
          const option = document.createElement('option');
          option.value = name;
          option.textContent = name;
          selectElement.appendChild(option);
      });
      
      // filtre
      function filterMapByDistrict(selectedDistrictName) {
          toggleAnimationLayers(false);

          let districtFilter;

          if (selectedDistrictName === 'ALL') {
              districtFilter = ['>', ['get', 'Nbr_morts'], 1]; 
              currentFilterMode = 'ALL';
              // Rétablir la visibilité des labels actifs
              map_deces.setLayoutProperty('labels_morts_anim', 'visibility', 'visible');
              
          } else {
              const shapeName = selectedDistrictName;
              districtFilter = ['==', 'shapeName', shapeName]; 
              
              map_deces.setLayoutProperty('labels_morts_anim', 'visibility', 'none');
              
              currentFilterMode = 'FILTERED';
              
              // Zoomer sur le district sélectionné
              const districtData = districtsArray.find(d => d.polygons[0].properties.shapeName === shapeName);
              if (districtData) {
                  map_deces.fitBounds(districtData.bounds, {
                      padding: ZOOM_PADDING,
                      duration: 1000,
                      essential: true 
                  });
              }
          }
          
          map_deces.setLayoutProperty('Villages_2_anim', 'visibility', 'visible'); 
          map_deces.setFilter('Districts_fill_static', districtFilter);
          map_deces.setFilter('borders_all_static', null); 
          map_deces.setFilter(
  'Villages_2_anim',
  [
    'match',
    ['get', 'shapeName'],
    activeDistrictNames,
    true,
    false
  ]
);
      }

      selectElement.addEventListener('change', (event) => {
          const selectedDistrictName = event.target.value;
          filterMapByDistrict(selectedDistrictName);
      });
      
      animateNextDistrict();


      //-------------------------------------------------------------------
      // 10) POP-UP
      //-------------------------------------------------------------------
      
      const DISTRICT_ATTRIBUTES_MAP = {
          'District': 'Nom du district', 
          'Nbr_morts': 'Nombre de décès',
      };

      const VILLAGE_ATTRIBUTES_MAP = {
          'noms': 'Nom du village détruit totalement ou partiellement', 
          'districts': 'Nom du district',
      };

      function createPopupContent(properties, attributeMap) {
          let content = '<table style="font-size: 11px; color: #333;">';
          for (const originalKey in attributeMap) {
              const displayLabel = attributeMap[originalKey];
              const value = properties[originalKey];
              if (value !== undefined) {
                  content += `<tr><td style="font-weight: bold; padding-right: 5px;">${displayLabel}</td><td>${value}</td></td></tr>`;
              }
          }
          content += '</table>';
          return content;
      }

      map_deces.on('click', 'Districts_fill_static', (e) => {
          if (e.features.length > 0) {
              const feature = e.features[0];
              new maplibregl.Popup()
                  .setLngLat(e.lngLat)
                  .setHTML('<h4>Informations du district</h4>' + createPopupContent(feature.properties, DISTRICT_ATTRIBUTES_MAP))
                  .addTo(map_deces);
          }
      });

      map_deces.on('click', 'Villages_2_anim', (e) => {
          if (e.features.length > 0) {
              const feature = e.features[0];
              new maplibregl.Popup()
                  .setLngLat(e.lngLat)
                  .setHTML('<h4>Information du village</h4>' + createPopupContent(feature.properties, VILLAGE_ATTRIBUTES_MAP))
                  .addTo(map_deces);
          }
      });
      
      map_deces.on('click', 'borders_all_static', (e) => {
          if (e.features.length > 0) {
              const feature = e.features[0];
              new maplibregl.Popup()
                  .setLngLat(e.lngLat)
                  .setHTML('<h4>Informations du district (Bordures)</h4>' + createPopupContent(feature.properties, DISTRICT_ATTRIBUTES_MAP))
                  .addTo(map_deces);
          }
      });

      const clickableLayers = ['Villages_2_anim', 'borders_all_static', 'Districts_fill_static']; 

      clickableLayers.forEach(layerId => {
          map_deces.on('mouseenter', layerId, () => {
              map_deces.getCanvas().style.cursor = 'pointer';
          });
          map_deces.on('mouseleave', layerId, () => {
              map_deces.getCanvas().style.cursor = '';
          });
      });
  });

}

/********************************************************************
 *  AVANT / APRÈS – COMPARAISON
 ********************************************************************/
function initAvantApres() {

  let compareControl = null;

  const center = [105.43, -6.05];
  const bounds = [
    [105.36, -6.17],
    [105.52, -5.92]
  ];

  const mapBefore = new maplibregl.Map({
    container: "before",
    style: "https://demotiles.maplibre.org/style.json",
    center,
    zoom: 9
  });

  const mapAfter = new maplibregl.Map({
    container: "after",
    style: "https://demotiles.maplibre.org/style.json",
    center,
    zoom: 9
  });

  mapBefore.addControl(new maplibregl.NavigationControl(), "top-left");
  mapAfter.addControl(new maplibregl.NavigationControl(), "top-left");

  let mapsLoaded = 0;

  function toggleDifferenceLayer(visible) {
    const visibility = visible ? "visible" : "none";

    ["diff-fill"].forEach(layerId => {
      if (mapBefore.getLayer(layerId)) {
        mapBefore.setLayoutProperty(layerId, "visibility", visibility);
      }
      if (mapAfter.getLayer(layerId)) {
        mapAfter.setLayoutProperty(layerId, "visibility", visibility);
      }
    });
  }

  function onMapsReady() {
    mapsLoaded++;

    if (mapsLoaded === 2) {

      // Création du slider AVANT/APRÈS
      compareControl = new maplibregl.Compare(
        mapBefore,
        mapAfter,
        "#comparison-container",
        {
          mousemove: false,
          orientation: "vertical"
        }
      );

      // Sélecteur de la couche de différence
      const diffToggle = document.getElementById("toggle-diff");
      if (diffToggle) {
        diffToggle.addEventListener("change", e => {
          toggleDifferenceLayer(e.target.checked);
        });
      }
    }
  }

  function addSourcesAndLayers(map, mode) {
    map.fitBounds(bounds, { padding: 40, duration: 0 });

    map.addSource("pre1883", {
      type: "geojson",
      data: "geojson/pre_1883.geojson"
    });

    map.addSource("post1883", {
      type: "geojson",
      data: "geojson/post_1883.geojson"
    });

    map.addSource("difference", {
      type: "geojson",
      data: "geojson/difference.geojson"
    });

    if (mode === "pre") {
      map.addLayer({
        id: "pre-fill",
        type: "fill",
        source: "pre1883",
        paint: {
          "fill-color": "rgba(0,119,204,0.5)",
          "fill-outline-color": "rgba(0,80,150,1)"
        }
      });
    } else {
      map.addLayer({
        id: "post-fill",
        type: "fill",
        source: "post1883",
        paint: {
          "fill-color": "rgba(220,53,69,0.5)",
          "fill-outline-color": "rgba(180,40,50,1)"
        }
      });
    }

    map.addLayer({
      id: "diff-fill",
      type: "fill",
      source: "difference",
      layout: { visibility: "none" },
      paint: {
        "fill-color": "rgba(255,193,7,0.5)",
        "fill-outline-color": "rgba(200,150,0,1)"
      }
    });

    const popupHandler = (e, label) => {
      const f = e.features && e.features[0];
      if (!f) return;
      const area = f.properties?.area
        ? Number(f.properties.area).toFixed(2) + " km²"
        : "";
      new maplibregl.Popup()
        .setLngLat(e.lngLat)
        .setHTML(`<strong>${label}</strong><br>${area}`)
        .addTo(map);
    };

    map.on("click", "diff-fill", e => popupHandler(e, "Différence"));
  }

  mapBefore.on("load", () => {
    addSourcesAndLayers(mapBefore, "pre");
    onMapsReady();
  });

  mapAfter.on("load", () => {
    addSourcesAndLayers(mapAfter, "post");
    onMapsReady();
  });

  mapRegistry["avant-apres"].map = mapBefore;
}

/********************************************************************
 *  INITIALISATION DE L’ONGLET ACTIF AU CHARGEMENT
 ********************************************************************/
document.addEventListener('DOMContentLoaded', () => {

  // Onglet actif par défaut (HTML)
  const activeTab = document.querySelector('#tabs li.active');

  if (!activeTab) return;

  const id = activeTab.dataset.tab;
  const entry = mapRegistry[id];

  if (entry && !entry.initialized) {
    entry.initFunction();
    entry.initialized = true;

    // Resize différé pour MapLibre (important pour le globe)
    setTimeout(() => {
      if (entry.map) entry.map.resize();
    }, 150);
  }
});
