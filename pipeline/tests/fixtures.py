"""A tiny synthetic catalog in the real file formats, for the population and pipeline tests."""
import csv
import io
from pathlib import Path

CAT_COLS = ["JCAT", "Satcat", "Launch_Tag", "Piece", "Type", "Name", "PLName", "LDate", "Parent",
            "SDate", "Primary", "DDate", "Status", "Dest", "Owner", "State", "Manufacturer", "Bus",
            "Motor", "Mass", "MassFlag", "DryMass", "DryFlag", "TotMass", "TotFlag", "Length",
            "LFlag", "Diameter", "DFlag", "Span", "SpanFlag", "Shape", "ODate", "Perigee", "PF",
            "Apogee", "AF", "Inc", "IF", "OpOrbit", "OQUAL", "AltNames"]
CUR_COLS = ["JCAT", "DeepCat", "Satcat", "Piece", "Active", "Type", "Name", "LDate", "Parent",
            "Owner", "State", "SDate", "ExpandedStatus", "DDate", "ODate", "Period", "Perigee", "PF",
            "Apogee", "AF", "Inc", "IF", "OpOrbit"]
CT_COLS = ["OBJECT_NAME", "OBJECT_ID", "NORAD_CAT_ID", "OBJECT_TYPE", "OPS_STATUS_CODE", "OWNER",
           "LAUNCH_DATE", "LAUNCH_SITE", "DECAY_DATE", "PERIOD", "INCLINATION", "APOGEE", "PERIGEE",
           "RCS", "DATA_STATUS_CODE", "ORBIT_CENTER", "ORBIT_TYPE"]


def ct(name, cospar, norad, otype, launch, decay="", apo="", peri="", rcs="", center="EA"):
    return {"OBJECT_NAME": name, "OBJECT_ID": cospar, "NORAD_CAT_ID": str(norad), "OBJECT_TYPE": otype,
            "OWNER": "US", "LAUNCH_DATE": launch, "DECAY_DATE": decay, "APOGEE": str(apo),
            "PERIGEE": str(peri), "RCS": str(rcs), "ORBIT_CENTER": center, "ORBIT_TYPE": "ORB"}


def cat(jcat, satcat, piece, typ, name, ldate, status="O", bus="-", L="0.0", D="0.0", S="0.0",
        shape="-", peri="0", apo="0", primary="Earth", lflag="", sdate=None):
    return {"JCAT": jcat, "Satcat": satcat, "Launch_Tag": piece[:8], "Piece": piece, "Type": typ,
            "Name": name, "LDate": ldate, "SDate": sdate or ldate, "Primary": primary,
            "DDate": "-", "Status": status, "Owner": "TEST", "Bus": bus, "Length": L, "LFlag": lflag,
            "Diameter": D, "Span": S, "Shape": shape, "Perigee": peri, "Apogee": apo}


def cur(jcat, satcat, piece, typ, name, ldate, status="In Earth orbit", peri="-", apo="-", ddate="-"):
    return {"JCAT": jcat, "Satcat": satcat, "Piece": piece, "Type": typ, "Name": name, "LDate": ldate,
            "Owner": "TEST", "SDate": ldate, "ExpandedStatus": status, "DDate": ddate,
            "ODate": "2026 Oct 10" if peri != "-" else "-", "Perigee": peri, "Apogee": apo}


CELESTRAK = [
    ct("ISS (ZARYA)", "1998-067A", 25544, "PAY", "1998-11-20", apo=425, peri=415),
    ct("ISS (ZVEZDA)", "2000-037A", 26400, "PAY", "2000-07-12", apo=425, peri=415, center="25544"),
    ct("STARLINK-1007", "2019-074A", 44713, "PAY", "2019-11-11", decay="2024-10-02", apo=300, peri=290),
    ct("LUNA 99", "1966-094A", 30000, "PAY", "1966-12-01", center="MO"),
    ct("STARLINK-30107", "2023-028A", 55000, "PAY", "2023-02-27", apo=482, peri=478),
    ct("SOME DEB", "1999-025A", 20000, "DEB", "1999-05-10", apo=860, peri=840, rcs="0.5"),
    ct("OTHER DEB", "1999-025B", 20001, "DEB", "1999-05-10", apo=860, peri=840),
    ct("SL-16 R/B", "2001-001B", 20002, "R/B", "2001-01-01", apo=850, peri=830),
    ct("STARLINK-33999", "2026-230A", 100500, "PAY", "2026-10-10", apo=300, peri=290),
    ct("SECRET SAT", "2020-001A", 20003, "PAY", "2020-01-01"),
    ct("SECRET SAT 2", "2020-001B", 20004, "PAY", "2020-01-01"),
    ct("PUBLIC SAT", "2020-001C", 20005, "PAY", "2020-01-01", apo=610, peri=590),
    # GCAT knows it came down; no orbit anywhere, so it gets no launch-mate orbit
    ct("GONE SAT", "2020-001D", 20006, "PAY", "2020-01-01"),
    # docked at the ISS, but CelesTrak has not yet set ORBIT_CENTER
    ct("DRAGON CRS-99", "2026-210A", 100600, "PAY", "2026-10-12", apo=425, peri=415),
    # catalogued payload riding on a host that only GCAT lists
    ct("COSMOS 9999", "1987-011A", 17369, "PAY", "1987-02-01", apo=800, peri=790),
    # an unidentified piece from the launch of GCAT's temporary object T00001
    ct("TRANSPORTER-99 OBJECT C", "2026-227C", 100700, "PAY", "2026-10-01", apo=516, peri=510),
]

GCAT_CAT = [
    cat("S25544", "25544", "1998-067A", "P", "Zarya", "1998 Nov 20", bus="77KS", L="12.6", D="4.2",
        S="23.9", shape="Cyl + 2 Pan", peri="350", apo="360"),
    cat("S26400", "26400", "2000-037A", "P", "Zvezda", "2000 Jul 12", status="DK", L="13.1", D="4.2"),
    cat("S44713", "44713", "2019-074A", "P      R  M", "Starlink 1007", "2019 Nov 11", status="R",
        bus="Starlink", L="0.2", D="2.8", S="9.0", shape="Box + pan", peri="280", apo="290", lflag="?"),
    cat("S30000", "30000", "1966-094A", "P", "Luna 99", "1966 Dec 1", status="DSO", primary="Earth"),
    cat("S55000", "55000", "2023-028A", "P      O  M", "Starlink 30107", "2023 Feb 27",
        bus="Starlink V2M", L="0.3", D="4.1", S="29.0", shape="Box + pan", peri="370", apo="380"),
    cat("S20000", "20000", "1999-025A", "D", "deb", "1999 May 10", sdate="2007 Jan 11"),
    cat("S20001", "20001", "1999-025B", "D", "deb", "1999 May 10", sdate="2007 Jan 11"),
    cat("S20002", "20002", "2001-001B", "R2", "Zenit-2 Stage 2", "2001 Jan 1", bus="11S772",
        L="11.1", D="3.9", S="11.1", shape="Cyl"),
    cat("S20003", "20003", "2020-001A", "P", "Secret Sat", "2020 Jan 1", L="2.0", D="1.0", S="2.0",
        shape="Box"),
    cat("S20004", "20004", "2020-001B", "P", "Secret Sat 2", "2020 Jan 1"),
    cat("S20005", "20005", "2020-001C", "P", "Public Sat", "2020 Jan 1", L="1.0", D="1.0", S="1.0",
        shape="Sphere"),
    cat("S101000", "101000", "2026-200A", "P      DC", "USA 999", "2026 Sep 1", bus="Starshield",
        L="0.3", D="4.1", S="29.0", shape="Box + pan"),
    cat("S20006", "20006", "2020-001D", "P", "Gone Sat", "2020 Jan 1", status="R"),
    cat("S17369", "17369", "1987-011A", "P", "Kosmos-9999", "1987 Feb 1", status="AO", L="2.0",
        D="1.3", S="2.0", shape="Cyl"),
]
GCAT_100K = [cat("S101001", "101001", "2026-201A", "P", "New Sat", "2026 Oct 1"),
             cat("S100600", "100600", "2026-210A", "PP", "Dragon CRS-99", "2026 Oct 12", status="DK",
                 L="8.1", D="4.0", S="8.1", shape="Cyl")]
GCAT_TMP = [
    cat("T00001", "NNA", "2026-227", "P       ?", "Cubesat A", "2026 Oct 1", L="0.3", D="0.1",
        S="0.3", shape="Box"),
    cat("T00002", "NNA", "2026-227", "P       ?", "Cubesat B", "2026 Oct 1", status="AO"),
    cat("T00003", "NNA", "2026-228", "P       ?", "Cubesat C", "2026 Oct 2", L="0.3", D="0.1",
        S="0.3", shape="Box"),
]
GCAT_AUX = [
    cat("A00001", "NNA", "1988-051", "C  FG", "Cooler cover", "1988 Jun 29", L="0.1", D="0.4",
        S="0.4", shape="Oval Disk"),
    cat("A00002", "20000", "1999-025", "D", "deb mistag", "1999 May 10"),
    cat("A00003", "NNA", "2020-100", "C  X", "Starlink 5823 bad TLEs", "2020 Jan 1"),
    cat("A00004", "NNA", "1987-011", "C  M", "Kosmos-9999 DU", "1987 Feb 1", L="3.7", D="1.3",
        S="3.7", shape="Cyl"),
    cat("A00005", "NNA", "2016-010", "C  I", "IDA-9", "2016 Jul 18", status="AO"),
]
GCAT_CUR = [
    cur("S25544", "25544", "1998-067A", "P", "Zarya", "1998 Nov 20", peri="415", apo="425"),
    cur("S26400", "26400", "2000-037A", "P", "Zvezda", "2000 Jul 12", status="Attached to S25544"),
    cur("S44713", "44713", "2019-074A", "P      R  M", "Starlink 1007", "2019 Nov 11",
        status="Reentered Earth atmosphere", ddate="2024 Oct  2"),
    cur("S30000", "30000", "1966-094A", "P", "Luna 99", "1966 Dec 1", status="In lunar orbit"),
    cur("S55000", "55000", "2023-028A", "P      O  M", "Starlink 30107", "2023 Feb 27", peri="478", apo="482"),
    cur("S20000", "20000", "1999-025A", "D", "deb", "2007 Jan 11", peri="840", apo="860"),
    cur("S20001", "20001", "1999-025B", "D", "deb", "2007 Jan 11", peri="840", apo="860"),
    cur("S20002", "20002", "2001-001B", "R2", "Zenit-2 Stage 2", "2001 Jan 1", peri="830", apo="850"),
    cur("S20003", "20003", "2020-001A", "P", "Secret Sat", "2020 Jan 1", peri="500", apo="520"),
    cur("S20004", "20004", "2020-001B", "P", "Secret Sat 2", "2020 Jan 1"),
    cur("S20005", "20005", "2020-001C", "P", "Public Sat", "2020 Jan 1", peri="590", apo="610"),
    cur("S101000", "101000", "2026-200A", "P      DC", "USA 999", "2026 Sep 1", peri="500", apo="510"),
    cur("S101001", "101001", "2026-201A", "P", "New Sat", "2026 Oct 1"),
    cur("S290001", "290001", "2020-002", "D", "Starlink 1234 dup", "2020 Jan 1", peri="550", apo="560"),
    cur("T00001", "NNA", "2026-227", "P       ?", "Cubesat A", "2026 Oct 1", peri="510", apo="516"),
    cur("T00002", "NNA", "2026-227", "P       ?", "Cubesat B", "2026 Oct 1", status="Attached to A11994"),
    cur("A00001", "NNA", "1988-051", "C  FG", "Cooler cover", "1988 Jun 29", peri="35700", apo="35750"),
    cur("A00002", "20000", "1999-025", "D", "deb mistag", "1999 May 10", peri="800", apo="900"),
    cur("A00003", "NNA", "2020-100", "C  X", "Starlink 5823 bad TLEs", "2020 Jan 1", peri="589", apo="600"),
    cur("S20006", "20006", "2020-001D", "P", "Gone Sat", "2020 Jan 1", status="Reentered Earth atmosphere",
        ddate="2024 Jan 1"),
    cur("S100600", "100600", "2026-210A", "PP", "Dragon CRS-99", "2026 Oct 12",
        status="Docked with A00005 IDA-9"),
    cur("A00005", "NNA", "2016-010", "C  I", "IDA-9", "2016 Jul 18", status="Attached to S25544 Zarya"),
    cur("S17369", "17369", "1987-011A", "P", "Kosmos-9999", "1987 Feb 1",
        status="Attached to A00004 Kosmos-9999 DU"),
    cur("A00004", "NNA", "1987-011", "C  M", "Kosmos-9999 DU", "1987 Feb 1", peri="790", apo="800"),
    cur("T00003", "NNA", "2026-228", "P       ?", "Cubesat C", "2026 Oct 2", peri="500", apo="505"),
]

# Expected outcome of the population rules on this catalog.
EXPECTED_CELESTRAK = {25544, 55000, 20000, 20001, 20002, 100500, 20003, 20004, 20005, 17369, 100700}
EXPECTED_GCAT_ONLY = {"S101000", "T00003", "A00001"}
EXPECTED_STACKED = {100600}           # docked with an ISS part: counted through the ISS
EXPECTED_STACK_HOSTS = {"A00004"}      # carries catalogued 17369, which represents it
EXPECTED_TMP_UNIDENTIFIED = {"T00001"}  # CelesTrak lists an unidentified piece from its launch
EXPECTED_EXCLUDED_GCAT_ONLY_NO_ORBIT = {"S101001"}


def _tsv(cols, rows, stamp="2026 Oct 17 1832:50"):
    lines = ["#" + "\t".join(cols), f"# Updated {stamp}"]
    for r in rows:
        lines.append("\t".join(str(r.get(c, "")) for c in cols))
    return "\n".join(lines) + "\n"


def _csv(cols, rows):
    buf = io.StringIO()
    w = csv.DictWriter(buf, fieldnames=cols, lineterminator="\n")
    w.writeheader()
    for r in rows:
        w.writerow({c: r.get(c, "") for c in cols})
    return buf.getvalue()


def file_contents():
    return {
        "gcat_satcat.tsv": _tsv(CAT_COLS, GCAT_CAT),
        "gcat_satcat100k.tsv": _tsv(CAT_COLS, GCAT_100K),
        "gcat_tmpcat.tsv": _tsv(CAT_COLS, GCAT_TMP),
        "gcat_auxcat.tsv": _tsv(CAT_COLS, GCAT_AUX),
        "gcat_currentcat.tsv": _tsv(CUR_COLS, GCAT_CUR, stamp="2026 Oct 17 1915:34"),
        "celestrak_satcat.csv": _csv(CT_COLS, CELESTRAK),
    }


def write_cache(directory, skip=()):
    d = Path(directory)
    d.mkdir(parents=True, exist_ok=True)
    for name, text in file_contents().items():
        if name not in skip:
            (d / name).write_text(text, encoding="utf-8")
    return d
