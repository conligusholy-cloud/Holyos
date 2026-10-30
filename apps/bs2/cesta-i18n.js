// BS2 — polská verze „cesty k rozhodnutí" (/cesta/pl…). Čeština zůstává zdrojem pravdy: PL stránky vznikají překladem hotového HTML
// podle slovníku níže (přesné řetězce). Přepínač jazyka CZ | PL se přidává do hlavičky obou verzí.
// Pozn.: když v češtině změníš text na /cesta, musí se doplnit i řádek ve slovníku — jinak ta věta zůstane česky (hlídá to `leftovers()`).

// ── Slovník CS → PL pro stránky (HTML) ──
const PAGES_PL = [
  // /cesta (hlavní stránka)
  ['Prádlomat — ať přesně víte, co vás čeká · Best Series 2.0', 'Prádlomat — wiesz dokładnie, czego się spodziewać · Best Series 2.0'],
  ['Cesta k vlastnímu prádlomatu ve třech krocích. Naším cílem je, abyste do 10 dní od schůzky měli všechny informace ke kvalifikovanému rozhodnutí.', 'Droga do własnego automatu pralniczego w trzech krokach. Naszym celem jest, abyś w ciągu 10 dni od spotkania miał wszystkie informacje potrzebne do świadomej decyzji.'],
  ['Jak to u nás probíhá', 'Jak to u nas wygląda'],
  ['Prádlomat MINI — samoobslužná prádelna', 'Prádlomat MINI — pralnia samoobsługowa'],
  ['aria-label="Ověřeno v praxi"', 'aria-label="Sprawdzone w praktyce"'],
  ['lokalit v ČR', 'lokalizacji w Czechach'],
  ['vlastní výroba', 'własna produkcja'],
  ['Pečeť kvality: 100% český výrobek, ověřený byznys model na více než 70 lokalitách v ČR, výroba 4 500 m²', 'Pieczęć jakości: 100% czeski produkt, sprawdzony model biznesowy w ponad 70 lokalizacjach w Czechach, produkcja 4 500 m²'],
  ['100% ČESKÝ VÝROBEK ★ OVĚŘENO NA 70+ LOKALITÁCH ★ VÝROBA 4 500 m² ★ ', '100% CZESKI PRODUKT ★ SPRAWDZONE W 70+ LOKALIZACJACH ★ PRODUKCJA 4 500 m² ★ '],
  ['<text class="seal-text">', '<text class="seal-text" textLength="490" lengthAdjust="spacingAndGlyphs">'], // PL text je delší než CZ – stáhne se na obvod pečeti
  ['Děkujeme za velký zájem', 'Dziękujemy za duże zainteresowanie'],
  ['Ať přesně víte,<br><span class="g">co vás čeká</span>', 'Wiesz dokładnie,<br><span class="g">czego się spodziewać</span>'],
  ['Zájemců máme hodně. Abychom se každému věnovali pořádně, dali jsme začátku jasný řád — tři kroky. Vážíme si svého i vašeho času a věříme, že úspěšní lidé s opravdovým zájmem to ocení.', 'Zainteresowanych mamy wielu. Aby każdemu poświęcić należytą uwagę, nadaliśmy początkowi jasny porządek — trzy kroki. Szanujemy swój i Twój czas i wierzymy, że ludzie sukcesu z prawdziwym zainteresowaniem to docenią.'],
  ['<b>Náš cíl: do 10 dní od schůzky</b> budete mít v ruce všechny informace, abyste se mohli kvalifikovaně rozhodnout — ano, nebo ne.', '<b>Nasz cel: w ciągu 10 dni od spotkania</b> otrzymasz wszystkie informacje, by podjąć świadomą decyzję — tak lub nie.'],
  ['Schůzka — online videohovor', 'Spotkanie — rozmowa wideo online'],
  ['Tady zjistíte, jestli je byznys právě pro vás a jestli dává smysl pokračovat v čerpání dalších informací.', 'Tu dowiesz się, czy ten biznes jest właśnie dla Ciebie i czy warto zbierać dalsze informacje.'],
  ['Návštěva výroby s majiteli', 'Wizyta w produkcji z właścicielami'],
  ['Zde zjistíte, jaké máme připravené lokality a jaké jsou možnosti financování.', 'Tu dowiesz się, jakie mamy przygotowane lokalizacje i jakie są możliwości finansowania.'],
  ['Kvalifikované rozhodnutí', 'Świadoma decyzja'],
  ['do 10 dní od schůzky', 'do 10 dni od spotkania'],
  ['Do 10 dní budete mít všechno potřebné a rozhodnete se — ano, nebo ne. Rozhodujeme se oba: prádlomat svěřujeme jen partnerům, se kterými si sedneme.', 'W ciągu 10 dni będziesz mieć wszystko, co potrzebne, i zdecydujesz — tak lub nie. Decydujemy obie strony: automat powierzamy tylko partnerom, z którymi się dogadujemy.'],
  ['Než se rozhodnete — to nejdůležitější', 'Zanim zdecydujesz — to, co najważniejsze'],
  ['Za 3 minuty pochopíte byznys,<br>který vydělává, <span class="g">i&nbsp;když spíte</span>', 'W 3 minuty zrozumiesz biznes,<br>który zarabia, <span class="g">nawet gdy śpisz</span>'],
  ['Otevřeli jsme kartu s tím nejdůležitějším. Bez omáček a bez tlaku — jen fakta, díky kterým se rozhodnete se zdravým rozumem, ne podle pocitu.', 'Otworzyliśmy kartę z tym, co najważniejsze. Bez ozdobników i bez presji — tylko fakty, dzięki którym zdecydujesz zdrowym rozsądkiem, a nie na podstawie wrażenia.'],
  ['<b>Kolik prádlomat reálně vydělává</b> a za jak dlouho se vám investice vrátí.', '<b>Ile automat realnie zarabia</b> i po jakim czasie zwraca się inwestycja.'],
  ['<b>Proč poptávka roste</b> rychleji, než stíháme otevírat nové provozy — a jak toho využít.', '<b>Dlaczego popyt rośnie</b> szybciej, niż nadążamy otwierać nowe punkty — i jak to wykorzystać.'],
  ['<b>Jak ho pořídit i bez vlastního kapitálu</b> — konkrétní možnosti financování.', '<b>Jak go nabyć nawet bez własnego kapitału</b> — konkretne możliwości finansowania.'],
  ['Ukažte mi, jak to funguje →', 'Pokaż mi, jak to działa →'],
  ['Nezávazně a zdarma · 3 minuty čtení · Počet partnerů je omezený', 'Bez zobowiązań i za darmo · 3 minuty czytania · Liczba partnerów jest ograniczona'],

  // společné: hlavička, patička, odkazy
  ['← zpět', '← wstecz'],
  ['Obchodní podmínky', 'Regulamin'],
  ['Ochrana osobních údajů', 'Ochrona danych osobowych'],
  ['Vyhledávač míst', 'Wyszukiwarka lokalizacji'],
  ['Prověření lokality', 'Weryfikacja lokalizacji'],
  ['Přihlášení', 'Logowanie'],
  ['Nastavení cookies', 'Ustawienia cookies'],
  ['právě si prohlíží', 'teraz przegląda'],
  ['Právě online + aktivní lidé za posledních 60 minut (klouzavé okno)', 'Teraz online + aktywni w ostatnich 60 minutach'],

  // /cesta/info
  ['Prádlomat — klíčové informace', 'Prádlomat — kluczowe informacje'],
  ['To nejdůležitější o podnikání se samoobslužným prádlomatem 24/7 — výnos, servis a připravená místa. A první klíčová otázka: jak prádlomat pořídíte.', 'To, co najważniejsze o biznesie z samoobsługowym automatem pralniczym 24/7 — przychód, serwis i przygotowane lokalizacje. I pierwsze kluczowe pytanie: jak nabędziesz automat.'],
  ['<p class="bx-eyebrow">To nejdůležitější</p>', '<p class="bx-eyebrow">To, co najważniejsze</p>'],
  ['Podnikání s <span class="g">prádlomatem 24/7</span>', 'Biznes z <span class="g">automatem pralniczym 24/7</span>'],
  ['Samoobslužná prádelna, která běží nonstop bez obsluhy. Vy vlastníte lokalitu a prádlomat — o zbytek se postaráme my.', 'Pralnia samoobsługowa działająca non stop bez obsługi. Ty jesteś właścicielem lokalizacji i automatu — resztą zajmiemy się my.'],
  ['První klíčová otázka', 'Pierwsze kluczowe pytanie'],
  ['Jak prádlomat <span class="g">pořídíte?</span>', 'Jak nabędziesz <span class="g">automat pralniczy?</span>'],
  ['Z vlastních zdrojů, nebo přes financování? Vyberte cestu, která je vám bližší — ukážeme vám, jak funguje a co pro vás znamená.', 'Ze środków własnych czy przez finansowanie? Wybierz drogę, która jest Ci bliższa — pokażemy Ci, jak działa i co dla Ciebie oznacza.'],
  ['Vlastní kapitál<small>z vlastních zdrojů →</small>', 'Kapitał własny<small>ze środków własnych →</small>'],
  ['Financování<small>splátky z výnosu →</small>', 'Finansowanie<small>raty z przychodu →</small>'],
  ['Proč prádlomat', 'Dlaczego automat pralniczy'],
  ['Výnos jednoho prádlomatu', 'Przychód jednego automatu'],
  ['tis.&nbsp;Kč', 'tys.&nbsp;CZK'],
  ['měsíčně v ČR', 'miesięcznie w Czechach'],
  ['Podle lokality, spádové oblasti a vytížení.', 'W zależności od lokalizacji, obszaru oddziaływania i wykorzystania.'],
  ['Instalaci, servis i provoz umíme kompletně zajistit', 'Instalację, serwis i obsługę możemy zapewnić w całości'],
  ['Instalaci, zaškolení, dálkový dohled, údržbu i infolinku — všechno bereme na sebe. Vy se staráte jen o svůj příjem.', 'Instalację, szkolenie, zdalny nadzór, konserwację i infolinię — wszystko bierzemy na siebie. Ty dbasz tylko o swój przychód.'],
  ['Místa máme pro vás připravená', 'Lokalizacje mamy dla Ciebie przygotowane'],
  ['Předjednané lokality s dobrou spádovostí a parkováním. Vybereme spolu tu nejlepší právě pro vás.', 'Wstępnie uzgodnione lokalizacje z dobrym zapleczem klientów i parkingiem. Wspólnie wybierzemy najlepszą właśnie dla Ciebie.'],

  // /cesta/vlastni-kapital
  ['Prádlomat — Vlastní kapitál', 'Prádlomat — Kapitał własny'],
  ['Prádlomat z vlastních zdrojů: celý výnos zůstává vám, bez splátek.', 'Automat pralniczy ze środków własnych: cały przychód zostaje Tobie, bez rat.'],
  ['Cesta 1 · Vlastní kapitál', 'Droga 1 · Kapitał własny'],
  ['Prádlomat z <span class="g">vlastních zdrojů</span>', 'Automat pralniczy ze <span class="g">środków własnych</span>'],
  ['Prádlomat pořídíte ze svého a celý výnos zůstává vám — bez splátek a bez závazků vůči třetí straně.', 'Automat nabywasz za własne środki i cały przychód zostaje Tobie — bez rat i bez zobowiązań wobec osób trzecich.'],
  ['Celý výnos je váš', 'Cały przychód jest Twój'],
  ['Žádné splátky, které by ukrajovaly z měsíčního příjmu.', 'Żadnych rat uszczuplających miesięczny dochód.'],
  ['Nejrychlejší rozjezd', 'Najszybszy start'],
  ['Bez schvalování financování — od rozhodnutí rovnou k instalaci.', 'Bez zatwierdzania finansowania — od decyzji od razu do instalacji.'],
  ['Servis a místo zajistíme', 'Serwis i lokalizację zapewnimy'],
  ['Provoz, údržbu i připravenou lokalitu řešíme za vás, stejně jako u financování.', 'Obsługę, konserwację i przygotowaną lokalizację załatwiamy za Ciebie, tak samo jak przy finansowaniu.'],
  ['Druhý nejdůležitější krok · 17,5 minuty', 'Drugi najważniejszy krok · 17,5 minuty'],

  // /cesta/financovani
  ['Prádlomat — Financování', 'Prádlomat — Finansowanie'],
  ['Prádlomat přes financování: nemusíte mít celou částku hned.', 'Automat pralniczy przez finansowanie: nie musisz mieć od razu całej kwoty.'],
  ['Cesta 2 · Financování', 'Droga 2 · Finansowanie'],
  ['Prádlomat přes <span class="g">financování</span>', 'Automat pralniczy przez <span class="g">finansowanie</span>'],
  ['Nemusíte mít celou částku hned. A od teď to platí víc než kdy dřív.', 'Nie musisz mieć od razu całej kwoty. A od teraz to prawda bardziej niż kiedykolwiek.'],
  ['Den, který změnil historii prádlomatu', 'Dzień, który zmienił historię automatu pralniczego'],
  ['Po 7 letech tvrdé práce', 'Po 7 latach ciężkiej pracy'],
  ['bankovní domy zalistovaly prádlomat a jeho byznys model jako financovatelný.', 'banki uznały automat pralniczy i jego model biznesowy za finansowalny.'],
  ['Co to pro vás znamená', 'Co to dla Ciebie oznacza'],
  ['Prádlomat ručí sám za sebe', 'Automat sam za siebie poręcza'],
  ['Podobně jako nemovitost — zárukou financování je samotný prádlomat a jeho výnos.', 'Podobnie jak nieruchomość — zabezpieczeniem finansowania jest sam automat i jego przychód.'],
  ['Financování i pro nové firmy', 'Finansowanie także dla nowych firm'],
  ['Pořídit ho můžete i jako nově vzniklý subjekt — bez dlouhé historie hospodaření.', 'Możesz go nabyć także jako nowo powstały podmiot — bez długiej historii działalności.'],
  ['Rámec podle vás', 'Limit dopasowany do Ciebie'],
  ['Schválit se dá v podstatě jakýkoli rámec. Je jen na vás, na kolik prádlomatů se cítíte.', 'Zatwierdzić można w zasadzie dowolny limit. To tylko od Ciebie zależy, ile automatów chcesz uruchomić.'],
  ['Příležitost <span class="g">století</span>', 'Okazja <span class="g">stulecia</span>'],
  ['A je na každém, kdo u toho bude.', 'A to od każdego zależy, kto przy tym będzie.'],

  // /cesta/schuzka
  ['Prádlomat — Schůzka 17,5 minuty', 'Prádlomat — Spotkanie 17,5 minuty'],
  ['Druhý nejdůležitější krok: 17,5 minuty, po kterých budete vědět, jestli je prádlomat pro vás. Online videohovor.', 'Drugi najważniejszy krok: 17,5 minuty, po których będziesz wiedzieć, czy automat pralniczy jest dla Ciebie. Rozmowa wideo online.'],
  ['Druhý nejdůležitější krok', 'Drugi najważniejszy krok'],
  ['Schůzka, po které <span class="g">budete vědět</span>', 'Spotkanie, po którym <span class="g">będziesz wiedzieć</span>'],
  ['Nebudeme vám nic prodávat. Během krátkého rozhovoru společně zjistíme, jestli je prádlomat pro vás — a jestli má smysl jít dál.', 'Nie będziemy Ci niczego sprzedawać. Podczas krótkiej rozmowy wspólnie sprawdzimy, czy automat pralniczy jest dla Ciebie — i czy warto iść dalej.'],
  ['Přesně tolik vám zabere', 'Dokładnie tyle Ci to zajmie'],
  ['Míň než jedna epizoda seriálu', 'Mniej niż jeden odcinek serialu'],
  ['Ani minutu navíc. Vážíme si vašeho času stejně jako svého.', 'Ani minuty więcej. Szanujemy Twój czas tak samo jak własny.'],
  ['Co si z těch 17,5 minut odnesete', 'Co wyniesiesz z tych 17,5 minut'],
  ['Jasnou odpověď, jestli je to pro vás', 'Jasną odpowiedź, czy to dla Ciebie'],
  ['Upřímně a bez tlaku. Rozhodujeme se oba — prádlomat svěřujeme jen partnerům, se kterými si sedneme.', 'Szczerze i bez presji. Decydujemy obie strony — automat powierzamy tylko partnerom, z którymi się dogadujemy.'],
  ['Čísla pro vaši lokalitu', 'Liczby dla Twojej lokalizacji'],
  ['Kolik může prádlomat vydělávat právě u vás a jak vypadá financování ve vašem případě.', 'Ile może zarabiać automat właśnie u Ciebie i jak wygląda finansowanie w Twoim przypadku.'],
  ['Další krok jasně na stole', 'Kolejny krok jasno na stole'],
  ['Odejdete s konkrétním plánem: co, kdy a jak — ať se rozhodnete ano, nebo ne.', 'Wyjdziesz z konkretnym planem: co, kiedy i jak — niezależnie, czy zdecydujesz się tak, czy nie.'],
  ['Termín potvrdíme zprávou. Kdyby vám nevyhovoval, jednoduše se ozvete a přesuneme ho.', 'Termin potwierdzimy wiadomością. Gdyby Ci nie odpowiadał, po prostu daj znać, a go przesuniemy.'],
];

// ── Slovník pro rezervační widget (JS zdroj) ──
const BOOKING_PL = [
  ["var DN = ['Ne', 'Po', 'Út', 'St', 'Čt', 'Pá', 'So'];", "var DN = ['Nd', 'Pn', 'Wt', 'Śr', 'Cz', 'Pt', 'So'];"],
  ["var DAYS = ['neděle', 'pondělí', 'úterý', 'středa', 'čtvrtek', 'pátek', 'sobota'];", "var DAYS = ['niedziela', 'poniedziałek', 'wtorek', 'środa', 'czwartek', 'piątek', 'sobota'];"],
  ["var MON = ['ledna', 'února', 'března', 'dubna', 'května', 'června', 'července', 'srpna', 'září', 'října', 'listopadu', 'prosince'];", "var MON = ['stycznia', 'lutego', 'marca', 'kwietnia', 'maja', 'czerwca', 'lipca', 'sierpnia', 'września', 'października', 'listopada', 'grudnia'];"],
  ["{ osobne: 'osobní schůzka', online: 'online video hovor' }", "{ osobne: 'spotkanie osobiste', online: 'rozmowa wideo online' }"],
  ["{ vlastni: 'vlastní kapitál', financovani: 'financování' }", "{ vlastni: 'kapitał własny', financovani: 'finansowanie' }"],
  ['Jak vám to <span class="g">vyhovuje?</span>', 'Jak Ci to <span class="g">odpowiada?</span>'],
  ['Klikněte a hned uvidíte volné termíny.', 'Kliknij, a od razu zobaczysz wolne terminy.'],
  ['Online videohovor<small>z pohodlí domova</small>', 'Rozmowa wideo online<small>z domowego zacisza</small>'],
  ['← zpět', '← wstecz'],
  ['Vyberte <span class="g">termín</span>', 'Wybierz <span class="g">termin</span>'],
  ['>Tento týden<', '>Ten tydzień<'],
  ['>Příští týden<', '>Przyszły tydzień<'],
  ['Nezávazně a zdarma · 17,5 minuty · Počet partnerů je omezený', 'Bez zobowiązań i za darmo · 17,5 minuty · Liczba partnerów jest ograniczona'],
  ['Načítám volné termíny…', 'Wczytuję wolne terminy…'],
  ['Nepodařilo se načíst termíny. Zkuste to prosím znovu.', 'Nie udało się wczytać terminów. Spróbuj ponownie.'],
  ['Tento týden už máme plno — podívejte se na příští týden.', 'W tym tygodniu mamy już komplet — zajrzyj na przyszły tydzień.'],
  ['Tento týden už máme plno. Ozveme se vám s nejbližším volným termínem.', 'W tym tygodniu mamy już komplet. Odezwiemy się z najbliższym wolnym terminem.'],
  ['Příští týden zatím nemáme vypsané termíny — zkuste tento týden.', 'Na przyszły tydzień nie mamy jeszcze terminów — spróbuj w tym tygodniu.'],
  ['Příští týden zatím nemáme vypsané termíny. Ozveme se vám s nejbližším volným.', 'Na przyszły tydzień nie mamy jeszcze terminów. Odezwiemy się z najbliższym wolnym.'],
  ["'Už máte rezervovaný termín'", "'Masz już zarezerwowany termin'"],
  ["'Máte rezervováno'", "'Masz rezerwację'"],
  ["'Těšíme se na vás '", "'Czekamy na Ciebie '"],
  ["dayHead(dt) + ' v ' + hhmm(dt)", "dayHead(dt) + ' o ' + hhmm(dt)"],
  ["'. Potvrzení vám pošleme.'", "'. Potwierdzenie wyślemy Ci e-mailem.'"],
  ['Změnit termín', 'Zmień termin'],
  ['Potvrďte <span class="g">termín</span>', 'Potwierdź <span class="g">termin</span>'],
  ['Potvrzení pošleme na ', 'Potwierdzenie wyślemy na '],
  ['Potvrdit termín →', 'Potwierdź termin →'],
  ['Potvrzením souhlasíte se <a href="/gdpr" target="_blank">zpracováním osobních údajů</a> pro domluvení schůzky a založení účtu v Best Series 2.0 (přihlašovací odkaz vám pošleme e-mailem).', 'Potwierdzając, wyrażasz zgodę na <a href="/gdpr" target="_blank">przetwarzanie danych osobowych</a> w celu umówienia spotkania i założenia konta w Best Series 2.0 (link do logowania wyślemy e-mailem).'],
  ['Nejsou to vaše údaje? Upravit', 'To nie Twoje dane? Edytuj'],
  ['← vybrat jiný termín', '← wybierz inny termin'],
  ['Kam vám <span class="g">pošleme potvrzení?</span>', 'Gdzie wysłać <span class="g">potwierdzenie?</span>'],
  ['Jméno <i class="rq">', 'Imię <i class="rq">'],
  ['Příjmení <i class="rq">', 'Nazwisko <i class="rq">'],
  ['placeholder="Novák"', 'placeholder="Kowalski"'],
  ['placeholder="jan@email.cz"', 'placeholder="jan@email.pl"'],
  ['placeholder="+420 777 123 456"', 'placeholder="+48 600 123 456"'],
  ['Souhlasím se <a href="/gdpr" target="_blank">zpracováním osobních údajů</a> pro domluvení schůzky a založení účtu v Best Series 2.0. <i class="rq">*</i>', 'Wyrażam zgodę na <a href="/gdpr" target="_blank">przetwarzanie danych osobowych</a> w celu umówienia spotkania i założenia konta w Best Series 2.0. <i class="rq">*</i>'],
  ['</i> povinné údaje', '</i> pola wymagane'],
  ['Zároveň vám založíme účet v Best Series 2.0 – přihlašovací odkaz vám pošleme e-mailem.', 'Jednocześnie założymy Ci konto w Best Series 2.0 – link do logowania wyślemy e-mailem.'],
  ["'Vyplňte prosím jméno.'", "'Podaj imię.'"],
  ["'Vyplňte prosím příjmení.'", "'Podaj nazwisko.'"],
  ["'Zadejte prosím platný e-mail.'", "'Podaj prawidłowy adres e-mail.'"],
  ["'Zadejte prosím telefon (aspoň 9 číslic).'", "'Podaj numer telefonu (min. 9 cyfr).'"],
  ["'Pro rezervaci je potřeba souhlas se zpracováním osobních údajů.'", "'Do rezerwacji wymagana jest zgoda na przetwarzanie danych osobowych.'"],
  ['Rezervuji termín…', 'Rezerwuję termin…'],
  ['Rezervaci se nepodařilo dokončit. Zkuste to prosím znovu.', 'Nie udało się dokończyć rezerwacji. Spróbuj ponownie.'],
  ["'📧 Na <b>'", "'📧 Na adres <b>'"],
  ["'</b> jsme vám poslali potvrzení a odkaz pro přihlášení do Best Series 2.0.'", "'</b> wysłaliśmy potwierdzenie i link do logowania w Best Series 2.0.'"],
  ["'📧 Potvrzení jsme poslali na <b>'", "'📧 Potwierdzenie wysłaliśmy na <b>'"],
  ["'</b>. Do Best Series 2.0 se přihlásíte svým stávajícím účtem.'", "'</b>. Do Best Series 2.0 zalogujesz się dotychczasowym kontem.'"],
  ['Změna termínu: vyberte si nový čas, původní rezervaci po potvrzení zrušíme.', 'Zmiana terminu: wybierz nowy czas, pierwotną rezerwację anulujemy po potwierdzeniu.'],
  ['gdpr: true };', "gdpr: true, lang: 'pl' };"],
  ["'/api/compounder/", "'/api/compounder/"], // (zůstává – výměnu na /api/cesta/ dělá bookingJs())
];

// Odkazy mezi stránkami cesty v PL verzi
const LINKS_PL = [
  ['href="/cesta/info"', 'href="/cesta/pl/info"'],
  ["'/cesta/info'", "'/cesta/pl/info'"],
  ['href="/cesta/vlastni-kapital"', 'href="/cesta/pl/vlastni-kapital"'],
  ['href="/cesta/financovani"', 'href="/cesta/pl/financovani"'],
  ['href="/cesta/schuzka"', 'href="/cesta/pl/schuzka"'],
  ['class="brand" href="/cesta"', 'class="brand" href="/cesta/pl"'],
  ['href="/cesta">← wstecz', 'href="/cesta/pl">← wstecz'],
  ['<script src="/cesta/booking.js"></script>', '<script src="/cesta/booking.pl.js"></script>'],
];

function applyPairs(text, pairs) {
  let out = String(text);
  [...pairs].sort((a, b) => b[0].length - a[0].length).forEach(([cs, pl]) => { if (cs !== pl) out = out.split(cs).join(pl); });
  return out;
}

// Přepínač jazyka (CZ | PL) – odkazy se dopočítají na klientovi: stejná podstránka v druhém jazyce + parametry z URL (t, l, utm…)
const SWITCH_CSS = '.lsw{display:inline-flex;border:1px solid rgba(120,160,255,.28);border-radius:999px;overflow:hidden;font-size:11.5px;font-weight:700;letter-spacing:.06em;margin-right:8px}.lsw a{padding:4px 10px;color:#9db6cd;line-height:1.3}.lsw a.on{background:linear-gradient(90deg,#1e86e0,#7c5cff);color:#fff}';
const SWITCH_HTML = '<span class="lsw" aria-label="Język / Jazyk"><a data-l="cs" href="/cesta" title="Čeština">CZ</a><a data-l="pl" href="/cesta/pl" title="Polski">PL</a></span>';
const SWITCH_JS = '<script>(function(){var p=location.pathname,q=location.search||"",pl=/^\\/cesta\\/pl(\\/|$)/.test(p);var cs=pl?p.replace(/^\\/cesta\\/pl/,"/cesta")||"/cesta":p,pp=pl?p:p.replace(/^\\/cesta/,"/cesta/pl");document.querySelectorAll(".lsw a").forEach(function(a){var l=a.getAttribute("data-l");a.href=(l==="pl"?pp:cs)+q;if((l==="pl")===pl)a.className="on";});})();</script>';

function addSwitch(html) {
  let out = String(html);
  const spacer = '<span style="margin-left:auto"></span>';
  if (out.indexOf(spacer) >= 0) out = out.replace(spacer, spacer + SWITCH_HTML);
  return out.replace('</style>', SWITCH_CSS + '</style>').replace('</body>', SWITCH_JS + '</body>');
}

function toPl(html) {
  let out = applyPairs(html, PAGES_PL);
  out = applyPairs(out, LINKS_PL);
  return out.replace('<html lang="cs">', '<html lang="pl">');
}
function bookingToPl(js) { return applyPairs(js, BOOKING_PL.filter((x) => x[0] !== x[1])); }

// Zbylé české řádky (diagnostika): vrátí texty s českou diakritikou, které ve výsledku zůstaly nepřeložené.
function leftovers(html) {
  const noScript = String(html).replace(/<script[\s\S]*?<\/script>/g, '').replace(/<style[\s\S]*?<\/style>/g, '').replace(/<svg[\s\S]*?<\/svg>/g, '');
  const texts = noScript.replace(/<[^>]+>/g, '\n').split('\n').map((s) => s.trim()).filter((s) => /[ěščřžýůďťňĚŠČŘŽÝŮĎŤŇ]/.test(s));
  return texts;
}

module.exports = { toPl, bookingToPl, addSwitch, leftovers, PAGES_PL, BOOKING_PL };
