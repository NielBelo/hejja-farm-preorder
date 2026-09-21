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
    label: "Vármegye és település",
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
        Személyes adataidat a Fiók → Személyes adatok oldalon bármikor
        megtekintheted és – a rendszer működéséhez szükséges korlátozások
        mellett – módosíthatod.
      </p>
    </>
  );
}
