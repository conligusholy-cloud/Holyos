// HolyOS — i18n slovník pro Ekonomiku prádlomatu (veřejná share stránka)
// Klíče = původní české texty. Pokud klíč pro daný jazyk chybí, vrátí se sám
// (= zobrazí se česky). Pro doplnění nového jazyka přidej kód do
// SUPPORTED_LANGUAGES v routes/business-tools.routes.js a do SHARE_LANGS v
// modules/prodejni-objednavky/index.html.
//
// Použití:
//   <script src="/modules/prodejni-objednavky/pradlomat-i18n.js"></script>
//   window.PradlomatI18n.setLang('en');     // přepne aktivní jazyk
//   window.PradlomatI18n.t('Investiční náklady');  // → "Investment costs"
//   window.PradlomatI18n.locale();          // → "en-GB" pro number formatting
//
// V rendereru pradlomat-economy.js se používá zkrácený alias _t() (lokálně
// definovaný), který spadne na klíč pokud helper není načten.

(function (global) {
  'use strict';

  var ACTIVE = 'cs';

  // BCP-47 lokále pro Intl/toLocaleString — používá se v formatu čísel a měn.
  var LOCALES = { cs: 'cs-CZ', en: 'en-GB', de: 'de-DE', fr: 'fr-FR' };

  // Překlady: dictionary[lang][csKey] = translated.
  // Záměrně používáme český text jako klíč, abychom mohli renderer postupně
  // konvertovat bez breaking changes (chybějící klíč = zobrazí se česky).
  var DICT = {
    en: {
      // Share page chrome (tool-share.html)
      'Ekonomika prádlomatu': 'Laundromat economics',
      'Interaktivní model návratnosti': 'Interactive ROI model',
      'Načítám pomůcku…': 'Loading tool…',
      'Odkaz nelze otevřít': 'Cannot open link',
      'Zkuste obnovit stránku nebo kontaktujte odesílatele.': 'Try refreshing the page or contact the sender.',
      'Odkaz je neplatný. Zkontrolujte, prosím, URL.': 'Invalid link. Please check the URL.',
      'Odkaz nenalezen nebo expiroval': 'Link not found or expired',
      'Tato pomůcka zatím není podporována.': 'This tool is not supported yet.',
      'Vaše uložené modely': 'Your saved models',
      '💡 Žlutá pole můžete libovolně měnit a zkoušet různé scénáře. Ostatní hodnoty se přepočítají automaticky.':
        '💡 You can edit the yellow fields freely and try different scenarios. Other values recalculate automatically.',
      'Žlutá pole můžete': 'You can edit',
      'libovolně měnit': 'the yellow fields freely',
      'a zkoušet různé scénáře. Ostatní hodnoty se přepočítají automaticky.': 'and try different scenarios. Other values recalculate automatically.',
      '↺ Výchozí': '↺ Reset',
      '📄 Stáhnout PDF': '📄 Download PDF',
      '💾 Uložit můj model': '💾 Save my model',
      'Název modelu': 'Model name',
      'Můj model': 'My model',
      'Pracovní model': 'Working model',
      'Uložená varianta se objeví v záhlaví nahoře a kdykoliv se k ní můžete vrátit. Odesilatele to také uvidí.':
        'The saved version will appear in the header above and you can return to it anytime. The sender will see it too.',
      'Zrušit': 'Cancel',
      'Uložit': 'Save',
      'Načten model: ': 'Model loaded: ',
      '✓ Model uložen': '✓ Model saved',
      'Nepodařilo se uložit: ': 'Failed to save: ',
      'Obnoveno výchozí nastavení': 'Default settings restored',
      'Obnovenoo výchozí nastavení': 'Default settings restored',
      'Jazyk': 'Language',

      // Tool toolbar / legend (pradlomat-economy.js)
      'Editovatelné': 'Editable',
      'Vypočítané': 'Computed',
      '💾 Uložit jako výchozí': '💾 Save as default',
      '↺ Tovární hodnoty': '↺ Factory values',
      '⬇ Stáhnout model (JSON)': '⬇ Download model (JSON)',
      'Ukládám…': 'Saving…',
      '✓ Uloženo': '✓ Saved',
      '✗ Chyba': '✗ Error',
      'Nepodařilo se uložit výchozí hodnoty: ': 'Failed to save defaults: ',

      // Result cards
      'Investice celkem': 'Total investment',
      'Obrat / měsíc': 'Revenue / month',
      'Zisk / měsíc': 'Profit / month',
      'Návratnost': 'Payback',
      'na jedno místo': 'per location',
      'po všech nákladech vč. servisu': 'after all costs incl. service',
      'ZTRÁTOVÝ provoz': 'LOSS-MAKING operation',
      'při této modelaci se neuhradí': 'will not pay off in this scenario',
      ' zákazníků / měs': ' customers / month',
      ' let': ' years',
      ' měsíců': ' months',

      // Sections
      'Investiční náklady': 'Investment costs',
      'jednorázové': 'one-time',
      'Modelace — měsíční': 'Modeling — monthly',
      'klíčový vstup': 'key input',
      'Měsíční fixní náklady': 'Monthly fixed costs',
      'Cena energií': 'Energy prices',
      'zdrojová data': 'source data',
      'DPH a cena služeb': 'VAT and service prices',
      'Cena detergentů': 'Detergent prices',
      'Velká pračka — spotřeba a náklady': 'Large washer — consumption and costs',
      'Malá pračka — spotřeba a náklady': 'Small washer — consumption and costs',
      'Sušička — spotřeba a souhrn nákladů': 'Dryer — consumption and cost summary',
      '10letý plán rozvoje': '10-year development plan',
      'vlastní síť prádlomatů': 'own laundromat network',
      'Cena služeb (vstup s DPH, automaticky bez DPH):': 'Service prices (input incl. VAT, auto excl. VAT):',
      'Náklad na cyklus (bez DPH):': 'Cost per cycle (excl. VAT):',
      'Náklad na sušení:': 'Drying cost:',

      // Input labels — Investment
      'Cena prádlomatu': 'Laundromat price',
      'Ø cena projekt + povolení': 'Ø project + permits',
      'Ø cena přípojek': 'Ø utility connections',

      // Modeling
      'Ø obrat na zákazníka': 'Ø revenue per customer',
      'Počet zákazníků za den': 'Customers per day',
      'Počet zákazníků za měsíc': 'Customers per month',
      'Obrat / den': 'Revenue / day',
      'Náklad pracích cyklů / měsíc': 'Wash cycle cost / month',
      'Ø náklad na zákazníka (ze zdroj. dat)': 'Ø cost per customer (from source data)',
      'Ø náklad na zákazníka': 'Ø cost per customer',
      'Celkem na zákazníka': 'Total per customer',

      // Fixed costs
      'Pravidelná údržba': 'Regular maintenance',
      'Software': 'Software',
      'Internet': 'Internet',
      'Infolinka': 'Hotline',
      'Pojištění': 'Insurance',
      'Nájem': 'Rent',
      'Servis': 'Service',
      'Fixní náklady celkem': 'Total fixed costs',

      // Energy
      'Elektrika': 'Electricity',
      'Vodné': 'Water',
      'Stočné': 'Sewage',

      // VAT / services
      'DPH (sazba)': 'VAT (rate)',
      'Malá pračka': 'Small washer',
      'Malá pračka s aviváží': 'Small washer with softener',
      'Velká pračka': 'Large washer',
      'Velká pračka s aviváží': 'Large washer with softener',
      'Sušička 15 min': 'Dryer 15 min',
      'Sušička 30 min': 'Dryer 30 min',
      'Sušička 45 min': 'Dryer 45 min',
      'Čistící program': 'Cleaning cycle',
      '… bez DPH': '… excl. VAT',

      // Detergents
      'Cena prášku': 'Detergent price',
      'Cena aviváže': 'Softener price',

      // Washer consumption rows
      'Voda': 'Water',
      'Prášek': 'Detergent',
      'Aviváž': 'Softener',
      'Voda + stočné': 'Water + sewage',
      'Bez aviváže celkem': 'Without softener — total',
      'S aviváží celkem': 'With softener — total',
      'Průměr velké pračky': 'Large washer — average',
      'Průměr malé pračky': 'Small washer — average',

      // Dryer rows
      '15 min': '15 min',
      '30 min': '30 min',
      '45 min': '45 min',
      'Ø praní (velká+malá)': 'Ø washing (large+small)',
      'Ø sušení (15+30 min)': 'Ø drying (15+30 min)',
      'Ø celkem na zákazníka': 'Ø total per customer',

      // Cost structure bar
      'Struktura měsíčních toků': 'Monthly cash-flow structure',
      'Obrat': 'Revenue',
      'Náklad pracích cyklů': 'Wash cycle costs',
      'Fixní náklady': 'Fixed costs',
      'Zisk': 'Profit',

      // 10-year projection
      'Kolik nových prádlomatů uvedete do provozu v každém roce? Pomůcka spočítá kumulativní zisk pro celou rostoucí síť.':
        'How many new laundromats will you launch each year? The tool computes the cumulative profit for the whole growing network.',
      'Roční zisk a kumulativní cashflow (10 let)': 'Annual profit and cumulative cash-flow (10 years)',
      'Roční provozní zisk': 'Annual operating profit',
      '(levá osa)': '(left axis)',
      'Kumulativní cashflow': 'Cumulative cash-flow',
      '(pravá osa)': '(right axis)',
      '← Tažením doleva zobrazíte další roky →': '← Swipe left to see more years →',
      'Prádlomatů po 10 letech': 'Laundromats after 10 years',
      'Roční zisk v 10. roce': 'Annual profit in year 10',
      'Kumulativní zisk po 10 letech': 'Cumulative profit after 10 years',
      'První kladná kumulace': 'First positive cumulation',
      'po 10 letech ne': 'not within 10 years',
      'Rok ': 'Year ',
      'rok': 'year',           // pro ". rok" suffix
      'beze změny': 'no change',
      ' stroj': ' machine',
      ' stroje': ' machines',
      ' strojů': ' machines',

      // Lock tooltips
      'Zamčeno': 'Locked',
      'Odemčené': 'Unlocked',
      'Zamčeno — zákazník nesmí měnit. Klik pro odemčení.': 'Locked — customer cannot edit. Click to unlock.',
      'Odemčené — zákazník může měnit. Klik pro zamčení.': 'Unlocked — customer can edit. Click to lock.',

      // Units
      'ks/den': 'pcs/day',
      'ks': 'pcs',
      '€/měs': '€/mo',
      '€/m³': '€/m³',
      '€/kWh': '€/kWh',
      '€/l': '€/l',
      'l/cyklus': 'l/cycle',
      'kWh/cyklus': 'kWh/cycle',
      '€ s DPH': '€ incl. VAT',
      'Rok': 'Year'
    },

    de: {
      'Ekonomika prádlomatu': 'Waschsalon-Wirtschaftlichkeit',
      'Interaktivní model návratnosti': 'Interaktives Amortisationsmodell',
      'Načítám pomůcku…': 'Lade Tool…',
      'Odkaz nelze otevřít': 'Link kann nicht geöffnet werden',
      'Zkuste obnovit stránku nebo kontaktujte odesílatele.': 'Versuchen Sie, die Seite zu aktualisieren oder kontaktieren Sie den Absender.',
      'Odkaz je neplatný. Zkontrolujte, prosím, URL.': 'Link ist ungültig. Bitte URL prüfen.',
      'Odkaz nenalezen nebo expiroval': 'Link nicht gefunden oder abgelaufen',
      'Tato pomůcka zatím není podporována.': 'Dieses Tool wird noch nicht unterstützt.',
      'Vaše uložené modely': 'Ihre gespeicherten Modelle',
      '💡 Žlutá pole můžete libovolně měnit a zkoušet různé scénáře. Ostatní hodnoty se přepočítají automaticky.':
        '💡 Sie können die gelben Felder beliebig ändern und verschiedene Szenarien testen. Andere Werte werden automatisch neu berechnet.',
      '↺ Výchozí': '↺ Standard',
      '📄 Stáhnout PDF': '📄 PDF herunterladen',
      '💾 Uložit můj model': '💾 Mein Modell speichern',
      'Název modelu': 'Modellname',
      'Můj model': 'Mein Modell',
      'Pracovní model': 'Arbeitsmodell',
      'Uložená varianta se objeví v záhlaví nahoře a kdykoliv se k ní můžete vrátit. Odesilatele to také uvidí.':
        'Die gespeicherte Variante erscheint oben in der Kopfzeile und Sie können jederzeit dorthin zurückkehren. Der Absender sieht sie auch.',
      'Zrušit': 'Abbrechen',
      'Uložit': 'Speichern',
      'Načten model: ': 'Modell geladen: ',
      '✓ Model uložen': '✓ Modell gespeichert',
      'Nepodařilo se uložit: ': 'Speichern fehlgeschlagen: ',
      'Obnoveno výchozí nastavení': 'Standardeinstellungen wiederhergestellt',
      'Obnovenoo výchozí nastavení': 'Standardeinstellungen wiederhergestellt',
      'Jazyk': 'Sprache',

      'Editovatelné': 'Bearbeitbar',
      'Vypočítané': 'Berechnet',
      '💾 Uložit jako výchozí': '💾 Als Standard speichern',
      '↺ Tovární hodnoty': '↺ Werkswerte',
      '⬇ Stáhnout model (JSON)': '⬇ Modell herunterladen (JSON)',
      'Ukládám…': 'Speichern…',
      '✓ Uloženo': '✓ Gespeichert',
      '✗ Chyba': '✗ Fehler',
      'Nepodařilo se uložit výchozí hodnoty: ': 'Standardwerte konnten nicht gespeichert werden: ',

      'Investice celkem': 'Investition gesamt',
      'Obrat / měsíc': 'Umsatz / Monat',
      'Zisk / měsíc': 'Gewinn / Monat',
      'Návratnost': 'Amortisation',
      'na jedno místo': 'pro Standort',
      'po všech nákladech vč. servisu': 'nach allen Kosten inkl. Service',
      'ZTRÁTOVÝ provoz': 'VERLUSTBETRIEB',
      'při této modelaci se neuhradí': 'amortisiert sich in diesem Szenario nicht',
      ' zákazníků / měs': ' Kunden / Monat',
      ' let': ' Jahre',
      ' měsíců': ' Monate',

      'Investiční náklady': 'Investitionskosten',
      'jednorázové': 'einmalig',
      'Modelace — měsíční': 'Modellierung — monatlich',
      'klíčový vstup': 'Schlüsseleingabe',
      'Měsíční fixní náklady': 'Monatliche Fixkosten',
      'Cena energií': 'Energiepreise',
      'zdrojová data': 'Quelldaten',
      'DPH a cena služeb': 'MwSt. und Servicepreise',
      'Cena detergentů': 'Waschmittelpreise',
      'Velká pračka — spotřeba a náklady': 'Große Waschmaschine — Verbrauch und Kosten',
      'Malá pračka — spotřeba a náklady': 'Kleine Waschmaschine — Verbrauch und Kosten',
      'Sušička — spotřeba a souhrn nákladů': 'Trockner — Verbrauch und Kostenübersicht',
      '10letý plán rozvoje': '10-Jahres-Entwicklungsplan',
      'vlastní síť prádlomatů': 'eigenes Waschsalon-Netzwerk',
      'Cena služeb (vstup s DPH, automaticky bez DPH):': 'Servicepreise (Eingabe inkl. MwSt., automatisch ohne MwSt.):',
      'Náklad na cyklus (bez DPH):': 'Kosten pro Zyklus (ohne MwSt.):',
      'Náklad na sušení:': 'Trocknungskosten:',

      'Cena prádlomatu': 'Waschsalon-Preis',
      'Ø cena projekt + povolení': 'Ø Projekt + Genehmigungen',
      'Ø cena přípojek': 'Ø Versorgungsanschlüsse',

      'Ø obrat na zákazníka': 'Ø Umsatz pro Kunde',
      'Počet zákazníků za den': 'Kunden pro Tag',
      'Počet zákazníků za měsíc': 'Kunden pro Monat',
      'Obrat / den': 'Umsatz / Tag',
      'Náklad pracích cyklů / měsíc': 'Waschzyklus-Kosten / Monat',
      'Ø náklad na zákazníka (ze zdroj. dat)': 'Ø Kosten pro Kunde (aus Quelldaten)',
      'Ø náklad na zákazníka': 'Ø Kosten pro Kunde',
      'Celkem na zákazníka': 'Gesamt pro Kunde',

      'Pravidelná údržba': 'Regelmäßige Wartung',
      'Software': 'Software',
      'Internet': 'Internet',
      'Infolinka': 'Hotline',
      'Pojištění': 'Versicherung',
      'Nájem': 'Miete',
      'Servis': 'Service',
      'Fixní náklady celkem': 'Fixkosten gesamt',

      'Elektrika': 'Strom',
      'Vodné': 'Wasser',
      'Stočné': 'Abwasser',

      'DPH (sazba)': 'MwSt. (Satz)',
      'Malá pračka': 'Kleine Waschmaschine',
      'Malá pračka s aviváží': 'Kleine Waschmaschine mit Weichspüler',
      'Velká pračka': 'Große Waschmaschine',
      'Velká pračka s aviváží': 'Große Waschmaschine mit Weichspüler',
      'Sušička 15 min': 'Trockner 15 Min.',
      'Sušička 30 min': 'Trockner 30 Min.',
      'Sušička 45 min': 'Trockner 45 Min.',
      'Čistící program': 'Reinigungsprogramm',
      '… bez DPH': '… ohne MwSt.',

      'Cena prášku': 'Waschmittelpreis',
      'Cena aviváže': 'Weichspülerpreis',

      'Voda': 'Wasser',
      'Prášek': 'Waschmittel',
      'Aviváž': 'Weichspüler',
      'Voda + stočné': 'Wasser + Abwasser',
      'Bez aviváže celkem': 'Ohne Weichspüler — gesamt',
      'S aviváží celkem': 'Mit Weichspüler — gesamt',
      'Průměr velké pračky': 'Große Waschmaschine — Durchschnitt',
      'Průměr malé pračky': 'Kleine Waschmaschine — Durchschnitt',

      '15 min': '15 Min.',
      '30 min': '30 Min.',
      '45 min': '45 Min.',
      'Ø praní (velká+malá)': 'Ø Waschen (groß+klein)',
      'Ø sušení (15+30 min)': 'Ø Trocknen (15+30 Min.)',
      'Ø celkem na zákazníka': 'Ø Gesamt pro Kunde',

      'Struktura měsíčních toků': 'Monatliche Cash-Flow-Struktur',
      'Obrat': 'Umsatz',
      'Náklad pracích cyklů': 'Waschzyklus-Kosten',
      'Fixní náklady': 'Fixkosten',
      'Zisk': 'Gewinn',

      'Kolik nových prádlomatů uvedete do provozu v každém roce? Pomůcka spočítá kumulativní zisk pro celou rostoucí síť.':
        'Wie viele neue Waschsalons werden Sie jedes Jahr in Betrieb nehmen? Das Tool berechnet den kumulativen Gewinn für das gesamte wachsende Netzwerk.',
      'Roční zisk a kumulativní cashflow (10 let)': 'Jahresgewinn und kumulativer Cash-Flow (10 Jahre)',
      'Roční provozní zisk': 'Jährlicher Betriebsgewinn',
      '(levá osa)': '(linke Achse)',
      'Kumulativní cashflow': 'Kumulativer Cash-Flow',
      '(pravá osa)': '(rechte Achse)',
      '← Tažením doleva zobrazíte další roky →': '← Nach links wischen für weitere Jahre →',
      'Prádlomatů po 10 letech': 'Waschsalons nach 10 Jahren',
      'Roční zisk v 10. roce': 'Jahresgewinn im 10. Jahr',
      'Kumulativní zisk po 10 letech': 'Kumulativer Gewinn nach 10 Jahren',
      'První kladná kumulace': 'Erste positive Kumulation',
      'po 10 letech ne': 'nicht innerhalb von 10 Jahren',
      'Rok ': 'Jahr ',
      'rok': 'Jahr',
      'beze změny': 'unverändert',
      ' stroj': ' Maschine',
      ' stroje': ' Maschinen',
      ' strojů': ' Maschinen',

      'Zamčeno': 'Gesperrt',
      'Odemčené': 'Entsperrt',
      'Zamčeno — zákazník nesmí měnit. Klik pro odemčení.': 'Gesperrt — Kunde kann nicht bearbeiten. Klick zum Entsperren.',
      'Odemčené — zákazník může měnit. Klik pro zamčení.': 'Entsperrt — Kunde kann bearbeiten. Klick zum Sperren.',

      'ks/den': 'St./Tag',
      'ks': 'St.',
      '€/měs': '€/Mon.',
      '€/m³': '€/m³',
      '€/kWh': '€/kWh',
      '€/l': '€/l',
      'l/cyklus': 'l/Zyklus',
      'kWh/cyklus': 'kWh/Zyklus',
      '€ s DPH': '€ inkl. MwSt.',
      'Rok': 'Jahr'
    },

    fr: {
      'Ekonomika prádlomatu': 'Économie de la laverie',
      'Interaktivní model návratnosti': 'Modèle interactif de rentabilité',
      'Načítám pomůcku…': 'Chargement de l\'outil…',
      'Odkaz nelze otevřít': 'Impossible d\'ouvrir le lien',
      'Zkuste obnovit stránku nebo kontaktujte odesílatele.': 'Essayez d\'actualiser la page ou contactez l\'expéditeur.',
      'Odkaz je neplatný. Zkontrolujte, prosím, URL.': 'Le lien est invalide. Veuillez vérifier l\'URL.',
      'Odkaz nenalezen nebo expiroval': 'Lien introuvable ou expiré',
      'Tato pomůcka zatím není podporována.': 'Cet outil n\'est pas encore pris en charge.',
      'Vaše uložené modely': 'Vos modèles enregistrés',
      '💡 Žlutá pole můžete libovolně měnit a zkoušet různé scénáře. Ostatní hodnoty se přepočítají automaticky.':
        '💡 Vous pouvez modifier librement les champs jaunes et essayer différents scénarios. Les autres valeurs sont recalculées automatiquement.',
      '↺ Výchozí': '↺ Par défaut',
      '📄 Stáhnout PDF': '📄 Télécharger PDF',
      '💾 Uložit můj model': '💾 Enregistrer mon modèle',
      'Název modelu': 'Nom du modèle',
      'Můj model': 'Mon modèle',
      'Pracovní model': 'Modèle de travail',
      'Uložená varianta se objeví v záhlaví nahoře a kdykoliv se k ní můžete vrátit. Odesilatele to také uvidí.':
        'La variante enregistrée apparaîtra dans l\'en-tête ci-dessus et vous pourrez y revenir à tout moment. L\'expéditeur la verra aussi.',
      'Zrušit': 'Annuler',
      'Uložit': 'Enregistrer',
      'Načten model: ': 'Modèle chargé : ',
      '✓ Model uložen': '✓ Modèle enregistré',
      'Nepodařilo se uložit: ': 'Échec de l\'enregistrement : ',
      'Obnoveno výchozí nastavení': 'Paramètres par défaut restaurés',
      'Obnovenoo výchozí nastavení': 'Paramètres par défaut restaurés',
      'Jazyk': 'Langue',

      'Editovatelné': 'Modifiable',
      'Vypočítané': 'Calculé',
      '💾 Uložit jako výchozí': '💾 Enregistrer par défaut',
      '↺ Tovární hodnoty': '↺ Valeurs d\'usine',
      '⬇ Stáhnout model (JSON)': '⬇ Télécharger le modèle (JSON)',
      'Ukládám…': 'Enregistrement…',
      '✓ Uloženo': '✓ Enregistré',
      '✗ Chyba': '✗ Erreur',
      'Nepodařilo se uložit výchozí hodnoty: ': 'Échec de l\'enregistrement des valeurs par défaut : ',

      'Investice celkem': 'Investissement total',
      'Obrat / měsíc': 'Chiffre d\'affaires / mois',
      'Zisk / měsíc': 'Profit / mois',
      'Návratnost': 'Retour sur investissement',
      'na jedno místo': 'par emplacement',
      'po všech nákladech vč. servisu': 'après tous les coûts y compris service',
      'ZTRÁTOVÝ provoz': 'EXPLOITATION DÉFICITAIRE',
      'při této modelaci se neuhradí': 'ne sera pas rentabilisé dans ce scénario',
      ' zákazníků / měs': ' clients / mois',
      ' let': ' ans',
      ' měsíců': ' mois',

      'Investiční náklady': 'Coûts d\'investissement',
      'jednorázové': 'unique',
      'Modelace — měsíční': 'Modélisation — mensuelle',
      'klíčový vstup': 'entrée clé',
      'Měsíční fixní náklady': 'Coûts fixes mensuels',
      'Cena energií': 'Prix de l\'énergie',
      'zdrojová data': 'données sources',
      'DPH a cena služeb': 'TVA et prix des services',
      'Cena detergentů': 'Prix des détergents',
      'Velká pračka — spotřeba a náklady': 'Grand lave-linge — consommation et coûts',
      'Malá pračka — spotřeba a náklady': 'Petit lave-linge — consommation et coûts',
      'Sušička — spotřeba a souhrn nákladů': 'Sèche-linge — consommation et résumé des coûts',
      '10letý plán rozvoje': 'Plan de développement sur 10 ans',
      'vlastní síť prádlomatů': 'propre réseau de laveries',
      'Cena služeb (vstup s DPH, automaticky bez DPH):': 'Prix des services (entrée TTC, automatiquement HT) :',
      'Náklad na cyklus (bez DPH):': 'Coût par cycle (HT) :',
      'Náklad na sušení:': 'Coût de séchage :',

      'Cena prádlomatu': 'Prix de la laverie',
      'Ø cena projekt + povolení': 'Ø projet + autorisations',
      'Ø cena přípojek': 'Ø raccordements',

      'Ø obrat na zákazníka': 'Ø chiffre d\'affaires par client',
      'Počet zákazníků za den': 'Clients par jour',
      'Počet zákazníků za měsíc': 'Clients par mois',
      'Obrat / den': 'Chiffre d\'affaires / jour',
      'Náklad pracích cyklů / měsíc': 'Coût des cycles de lavage / mois',
      'Ø náklad na zákazníka (ze zdroj. dat)': 'Ø coût par client (données sources)',
      'Ø náklad na zákazníka': 'Ø coût par client',
      'Celkem na zákazníka': 'Total par client',

      'Pravidelná údržba': 'Maintenance régulière',
      'Software': 'Logiciel',
      'Internet': 'Internet',
      'Infolinka': 'Ligne d\'assistance',
      'Pojištění': 'Assurance',
      'Nájem': 'Loyer',
      'Servis': 'Service',
      'Fixní náklady celkem': 'Coûts fixes totaux',

      'Elektrika': 'Électricité',
      'Vodné': 'Eau',
      'Stočné': 'Égouts',

      'DPH (sazba)': 'TVA (taux)',
      'Malá pračka': 'Petit lave-linge',
      'Malá pračka s aviváží': 'Petit lave-linge avec assouplissant',
      'Velká pračka': 'Grand lave-linge',
      'Velká pračka s aviváží': 'Grand lave-linge avec assouplissant',
      'Sušička 15 min': 'Sèche-linge 15 min',
      'Sušička 30 min': 'Sèche-linge 30 min',
      'Sušička 45 min': 'Sèche-linge 45 min',
      'Čistící program': 'Programme de nettoyage',
      '… bez DPH': '… HT',

      'Cena prášku': 'Prix de la lessive',
      'Cena aviváže': 'Prix de l\'assouplissant',

      'Voda': 'Eau',
      'Prášek': 'Lessive',
      'Aviváž': 'Assouplissant',
      'Voda + stočné': 'Eau + égouts',
      'Bez aviváže celkem': 'Sans assouplissant — total',
      'S aviváží celkem': 'Avec assouplissant — total',
      'Průměr velké pračky': 'Grand lave-linge — moyenne',
      'Průměr malé pračky': 'Petit lave-linge — moyenne',

      '15 min': '15 min',
      '30 min': '30 min',
      '45 min': '45 min',
      'Ø praní (velká+malá)': 'Ø lavage (grand+petit)',
      'Ø sušení (15+30 min)': 'Ø séchage (15+30 min)',
      'Ø celkem na zákazníka': 'Ø total par client',

      'Struktura měsíčních toků': 'Structure des flux mensuels',
      'Obrat': 'Chiffre d\'affaires',
      'Náklad pracích cyklů': 'Coût des cycles',
      'Fixní náklady': 'Coûts fixes',
      'Zisk': 'Profit',

      'Kolik nových prádlomatů uvedete do provozu v každém roce? Pomůcka spočítá kumulativní zisk pro celou rostoucí síť.':
        'Combien de nouvelles laveries mettrez-vous en service chaque année ? L\'outil calcule le profit cumulé pour l\'ensemble du réseau en croissance.',
      'Roční zisk a kumulativní cashflow (10 let)': 'Profit annuel et cash-flow cumulé (10 ans)',
      'Roční provozní zisk': 'Profit d\'exploitation annuel',
      '(levá osa)': '(axe gauche)',
      'Kumulativní cashflow': 'Cash-flow cumulé',
      '(pravá osa)': '(axe droit)',
      '← Tažením doleva zobrazíte další roky →': '← Glisser vers la gauche pour voir plus d\'années →',
      'Prádlomatů po 10 letech': 'Laveries après 10 ans',
      'Roční zisk v 10. roce': 'Profit annuel en année 10',
      'Kumulativní zisk po 10 letech': 'Profit cumulé après 10 ans',
      'První kladná kumulace': 'Première cumulation positive',
      'po 10 letech ne': 'pas dans les 10 ans',
      'Rok ': 'Année ',
      'rok': 'année',
      'beze změny': 'sans changement',
      ' stroj': ' machine',
      ' stroje': ' machines',
      ' strojů': ' machines',

      'Zamčeno': 'Verrouillé',
      'Odemčené': 'Déverrouillé',
      'Zamčeno — zákazník nesmí měnit. Klik pro odemčení.': 'Verrouillé — le client ne peut pas modifier. Cliquez pour déverrouiller.',
      'Odemčené — zákazník může měnit. Klik pro zamčení.': 'Déverrouillé — le client peut modifier. Cliquez pour verrouiller.',

      'ks/den': 'pcs/jour',
      'ks': 'pcs',
      '€/měs': '€/mois',
      '€/m³': '€/m³',
      '€/kWh': '€/kWh',
      '€/l': '€/l',
      'l/cyklus': 'l/cycle',
      'kWh/cyklus': 'kWh/cycle',
      '€ s DPH': '€ TTC',
      'Rok': 'Année'
    }
  };

  function setLang(code) {
    code = (code || '').toLowerCase();
    ACTIVE = (DICT[code] || code === 'cs') ? code : 'cs';
  }
  function getLang() { return ACTIVE; }
  function locale() { return LOCALES[ACTIVE] || 'cs-CZ'; }

  // Hlavní lookup. Pokud klíč pro aktivní jazyk chybí, vrátí klíč sám (CS fallback).
  function t(key) {
    if (ACTIVE === 'cs' || !key) return key;
    var d = DICT[ACTIVE];
    if (d && Object.prototype.hasOwnProperty.call(d, key)) return d[key];
    return key;
 