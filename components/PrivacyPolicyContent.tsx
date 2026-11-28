const DATA_ITEMS = [
  {
    label: "Név",
    description: "A vásárló és az előrendelések azonosítására.",
  },
  {
    label: "E-mail-cím",
    description:
      "A felhasználói fiók kezelésére, valamint a regisztrációval, előrendelésekkel és átvétellel kapcsolatos értesítések küldésére.",
  },
  {
    label: "Telefonszám",
    description:
      "Szükség esetén az előrendeléssel vagy az átvétellel kapcsolatos közvetlen egyeztetésre.",
  },
  {
    label: "Megye és település",
    description:
      "A vásárlói adatok és az átvételhez kapcsolódó információk kezelésére.",
  },
  {
    label: "Előrendelési adatok",
    description:
      "A leadott, módosított vagy törölt előrendelések nyilvántartására és teljesítésére.",
  },
  {
    label: "Módosítások adatai",
    description:
      "Az előrendelések változásainak nyomon követésére, beleértve a módosítás időpontját és előzményeit.",
  },
  {
    label: "Jelszó",
    description:
      "A fiók védelmét szolgálja. A jelszót nem jelenítjük meg, és nem férünk hozzá annak olvasható formájához.",
  },
];

const DELETION_ITEMS = [
  {
    label: "Ami véglegesen törlődik",
    description:
      "A neved, e-mail-címed, telefonszámod, megyéd és településed, a belépési adataid, valamint az adatkezelési hozzájárulásaid és a regisztrációs meghívód. A törlés nem vonható vissza.",
  },
  {
    label: "Ami névtelenül megmarad",
    description:
      "A korábbi rendeléseid tartalma (termékek, mennyiségek, átvételi nap, évad) statisztikai célból megmarad, de a kapcsolat közted és a rendelés között megszűnik, így a rendelésből nem derül ki, ki adta le. A rendeléseidhez írt megjegyzések törlődnek.",
  },
  {
    label: "A törlés nyilvántartása",
    description:
      "A törlés megtörténtének igazolására - az elszámoltathatóság és az esetleges jogi igények érvényesítése miatt - a törölt fiók nevét, a törlés időpontját és azt, hogy a törlést te vagy az üzemeltető kezdeményezte, 3 évig megőrizzük, majd automatikusan törlünk. Más adatot (például e-mail-címet, telefonszámot, lakcímet) nem őrzünk meg.",
  },
  {
    label: "Biztonsági mentések és korábbi levelek",
    description:
      "A rendszer biztonsági mentései és a levelezőszolgáltató naplói a korábban kiküldött értesítésekről a szolgáltatók saját megőrzési szabályai szerint, korlátozott ideig még tartalmazhatnak adatokat. Ezekből a törlés után sem küldünk újabb levelet.",
  },
];

export default function PrivacyPolicyContent() {
  return (
    <>
      <p className="text-gray-600">
        A Héjja Ökofarm kizárólag az előrendelési rendszer működéséhez és a
        vásárlókkal történő kapcsolattartáshoz szükséges személyes adatokat
        kezeli.
      </p>

      <h2 className="mt-8 mb-3 text-lg font-semibold text-gray-700">
        Milyen adatokat kezelünk és mire használjuk?
      </h2>

      <ul className="space-y-4">
        {DATA_ITEMS.map((item) => (
          <li
            key={item.label}
            className="rounded-lg border border-gray-100 bg-gray-50 p-3"
          >
            <p className="font-semibold text-gray-700">{item.label}</p>
            <p className="mt-1 text-gray-600">{item.description}</p>
          </li>
        ))}
      </ul>

      <h2 className="mt-8 mb-3 text-lg font-semibold text-gray-700">
        Mire nem használjuk az adatokat?
      </h2>

      <p className="rounded-lg bg-gray-50 p-3 text-gray-600">
        Az adatokat nem használjuk reklám- vagy hírlevélküldésre, és nem
        adjuk át másnak marketingcélból.
      </p>

      <h2 className="mt-8 mb-3 text-lg font-semibold text-gray-700">
        Saját adatok kezelése
      </h2>

      <p className="text-gray-600">
        Személyes adataidat a Személyes adatok oldalon bármikor
        megtekintheted és - a rendszer működéséhez szükséges korlátozások
        mellett - módosíthatod.
      </p>

      <h2 className="mt-8 mb-3 text-lg font-semibold text-gray-700">
        Fiók és adatok törlése
      </h2>

      <p className="text-gray-600">
        A fiókodat bármikor törölheted a Személyes adatok oldal alján.
        Kérésedre a törlést az üzemeltető is elvégzi. Aktív, még le nem zajlott
        átvételi napra szóló rendelés mellett a fiók nem törölhető, ilyenkor
        előbb a rendelést kell lemondani.
      </p>

      <ul className="mt-4 space-y-4">
        {DELETION_ITEMS.map((item) => (
          <li
            key={item.label}
            className="rounded-lg border border-gray-100 bg-gray-50 p-3"
          >
            <p className="font-semibold text-gray-700">{item.label}</p>
            <p className="mt-1 text-gray-600">{item.description}</p>
          </li>
        ))}
      </ul>
    </>
  );
}
