export const SECOND_HISTORICAL_IMPORT_BATCH_KEY =
  "historical-import-2026-09-10-second-batch-v1";
export const SECOND_HISTORICAL_PRODUCTION_CONFIRMATION =
  "IMPORT_SECOND_HISTORICAL_BATCH_TO_PRODUCTION";
export const SECOND_HISTORICAL_RECEIPT_OCR_SHA256 =
  "e0c6d0c0f541e310a3f51146f0bc33955a27ab01a541a9deae1b49c2826d56de";
export const SECOND_HISTORICAL_SEMANTIC_SHA256 =
  "2b5f2fd6d73bb668caef2d117767eb1ddc67f13f60a61a51c7d5de4be9c09936";
export const SECOND_HISTORICAL_IMPORT_EXPECTED_FILE_COUNT = 384;
export const SECOND_HISTORICAL_IMPORT_EXPECTED_TOTAL_BYTES = 100_769_730;
export const SECOND_HISTORICAL_IMPORT_EXPECTED_MANIFEST_HASH =
  "f7cf305f2ff3b17ddbc0837a5069f040d98ee79c3dea68ceb6e0691f5f844fc3";
export const SECOND_HISTORICAL_IMPORT_EXPECTED_ASSIGNMENT_COUNTS = {
  sealed_contract: 41,
  agreement: 6,
  financial: 219,
  archive: 3,
  auxiliary: 115,
} as const;
export const SECOND_HISTORICAL_IMPORT_DEFAULT_SOURCE_ROOT =
  "/tmp/second-historical-import-source";
export const SECOND_HISTORICAL_IMPORT_UPLOAD_ROOT =
  "/app/uploads/contracts/historical/2026/09/10";
export const SECOND_HISTORICAL_IMPORT_AUXILIARY_UPLOAD_ROOT =
  "/app/uploads/contract-auxiliary/historical/2026/09/10";

export type SecondHistoricalContractCategory =
  | "main_business"
  | "non_main"
  | "asset";
export type SecondHistoricalContractSubtype =
  | "engineering_consulting"
  | "non_main_income"
  | "non_main_expense"
  | "procurement";

export interface SecondHistoricalRootSpec {
  mainFileName: string;
  projectName?: string;
  businessContractNo?: string;
  contractDateOverride?: string;
  /** 指定该合同承接的财务原件金额；同目录拆分多份合同时使用。 */
  financialAmounts?: number[];
  /** 该文件是重复签署版本，只归档，不建立独立合同。 */
  archiveOnly?: boolean;
  /** 该文件仅作为主合同辅助材料留痕，不建立独立合同。 */
  auxiliaryOnly?: boolean;
  /** 仅此合同承接目录中的补充协议。 */
  ownsSupplements?: boolean;
}

export type SecondHistoricalDeclaredMainTarget =
  | "sealed_contract"
  | "archive"
  | "auxiliary";

export function secondHistoricalDeclaredMainTarget(
  root: SecondHistoricalRootSpec,
): SecondHistoricalDeclaredMainTarget {
  if (root.archiveOnly && root.auxiliaryOnly) {
    throw new Error("同一文件不能同时设为仅归档和仅辅助材料");
  }
  if (root.archiveOnly) return "archive";
  if (root.auxiliaryOnly) return "auxiliary";
  return "sealed_contract";
}

export interface SecondHistoricalFamilySpec {
  id: string;
  directory: string;
  projectName: string;
  category: SecondHistoricalContractCategory;
  declaredSubtype: SecondHistoricalContractSubtype;
  area: string;
  partyA: string;
  partyB: string;
  partyC?: string;
  mainFileName: string;
  roots?: SecondHistoricalRootSpec[];
  businessContractNo?: string;
  contractDateOverride?: string;
  expectedInvoiceAmount: number;
  expectedSettlementAmount: number;
  restoreContractId?: string;
  target?: {
    amount: number;
    quantity: number;
    unitPrice: number;
    confirmedAmount: number;
    confirmedQuantity: number;
    quantityUnit: string;
  };
}

const ENGINEERING = "北京羽隶工程咨询有限公司";

export const SECOND_HISTORICAL_IMPORT_FAMILIES: readonly SecondHistoricalFamilySpec[] =
  [
    {
      id: "second-001",
      directory:
        "非主营项目合同/非主营收入/北京北建大城市规划设计研究院有限公司",
      projectName: "北京市历史文化名村、传统村落保护发展实施路径研究",
      category: "non_main",
      declaredSubtype: "non_main_income",
      area: "全部",
      partyA: "北京北建大城市规划设计研究院有限公司",
      partyB: ENGINEERING,
      mainFileName: "1-咨询合同-20241128￥225500.pdf",
      expectedInvoiceAmount: 225_500,
      expectedSettlementAmount: 225_500,
    },
    {
      id: "second-002",
      directory:
        "非主营项目合同/非主营收入/北京东恒置业有限公司/2023-雍景桃源项目￥850000√",
      projectName: "雍景桃源项目闲置地相关问题咨询及协调工作",
      category: "non_main",
      declaredSubtype: "non_main_income",
      area: "全部",
      partyA: "北京东恒置业有限公司",
      partyB: ENGINEERING,
      mainFileName: "1-咨询服务协议-雍景桃源项目-20221231￥850000.pdf",
      expectedInvoiceAmount: 850_000,
      expectedSettlementAmount: 850_000,
    },
    {
      id: "second-003",
      directory:
        "非主营项目合同/非主营收入/北京清水玖顺工程咨询有限公司/2025-顺义理疗研究中心用房技术咨询服务合同（验收分包）20251118￥600000",
      projectName: "椿萱茂北京璞湾长者社区项目3号楼规划验收咨询服务",
      category: "non_main",
      declaredSubtype: "non_main_income",
      area: "全部",
      partyA: "北京清水玖顺工程咨询有限公司",
      partyB: ENGINEERING,
      mainFileName: "1-技术咨询服务合同-20251118￥600000.pdf",
      roots: [
        { mainFileName: "1-技术咨询服务合同-20251118￥600000.pdf" },
        {
          mainFileName:
            "顺义理疗研究中心用房技术咨询服务合同（验收分包）20251118.pdf",
          archiveOnly: true,
        },
      ],
      expectedInvoiceAmount: 600_000,
      expectedSettlementAmount: 520_000,
    },
    {
      id: "second-004",
      directory:
        "非主营项目合同/非主营收入/北京市佳利华经济开发有限责任公司/2024-璞湾项目￥1800000√",
      projectName: "璞湾项目咨询服务",
      category: "non_main",
      declaredSubtype: "non_main_income",
      area: "全部",
      partyA: "北京市佳利华经济开发有限责任公司",
      partyB: ENGINEERING,
      mainFileName: "1-璞湾项目咨询服务合同-20240907￥1200000.pdf",
      expectedInvoiceAmount: 1_800_000,
      expectedSettlementAmount: 1_800_000,
    },
    {
      id: "second-005",
      directory:
        "非主营项目合同/非主营收入/北京御海天朝文化发展有限公司/2024-北京市西城区后海项目的建设用地进行第二顺位抵押￥960000√",
      projectName: "北京市西城区后海项目建设用地第二顺位抵押登记办理",
      category: "non_main",
      declaredSubtype: "non_main_income",
      area: "全部",
      partyA: "北京御海天朝文化发展有限公司",
      partyB: ENGINEERING,
      mainFileName: "1-咨询服务协议（抵押登记办理咨询）-20240418￥960000.pdf",
      expectedInvoiceAmount: 960_000,
      expectedSettlementAmount: 960_000,
    },
    {
      id: "second-006",
      directory:
        "非主营项目合同/非主营收入/北京御海天朝文化发展有限公司/2025-北京市西城区后海项目的交通影响评价咨询￥1500000√",
      projectName: "北京市西城区后海项目交通影响评价咨询",
      category: "non_main",
      declaredSubtype: "non_main_income",
      area: "全部",
      partyA: "北京御海天朝文化发展有限公司",
      partyB: ENGINEERING,
      mainFileName:
        "1-咨询服务协议-北京市西城区后海项目的交通影响评价咨询20251219￥1500000.pdf",
      expectedInvoiceAmount: 1_500_000,
      expectedSettlementAmount: 1_500_000,
    },
    {
      id: "second-007",
      directory: "非主营项目合同/非主营收入/北京中科软科技有限公司→工程",
      projectName:
        "苏家坨镇一镇一园集体产业用地前沙涧S7-2地块项目（1#集体产业用房等14项）弱电项目",
      category: "non_main",
      declaredSubtype: "non_main_income",
      area: "全部",
      partyA: "北京中科软科技有限公司",
      partyB: ENGINEERING,
      mainFileName: "1-工程安装合同书-20241017￥4900000.pdf",
      expectedInvoiceAmount: 2_188_138.94,
      expectedSettlementAmount: 2_188_138.94,
    },
    {
      id: "second-008",
      directory: "非主营项目合同/非主营收入/鲁能集团有限公司",
      projectName: "基于绿色环保、智慧科技的城镇老旧小区旧改技术研究",
      category: "non_main",
      declaredSubtype: "non_main_income",
      area: "全部",
      partyA: "鲁能集团有限公司",
      partyB: ENGINEERING,
      mainFileName:
        "1-技术开发（委托）合同-基于绿色环保、智慧科技的城镇老旧小区旧改技术研究-20220801￥980000.pdf",
      businessContractNo: "SGLN0000KXJS2000118",
      expectedInvoiceAmount: 686_000,
      expectedSettlementAmount: 686_000,
    },
    {
      id: "second-009",
      directory:
        "非主营项目合同/非主营支出/安徽特鸽建筑工程有限公司/20241016￥100000√",
      projectName: "房屋墙面修复",
      category: "non_main",
      declaredSubtype: "non_main_expense",
      area: "全部",
      partyA: ENGINEERING,
      partyB: "安徽特鸽建筑工程有限公司",
      mainFileName: "1-劳务外包合同-20241016￥100000.pdf",
      expectedInvoiceAmount: 100_000,
      expectedSettlementAmount: 100_000,
    },
    {
      id: "second-010",
      directory:
        "非主营项目合同/非主营支出/安徽特鸽建筑工程有限公司/20241018￥162500√",
      projectName: "北京市朝阳区安立路甲3号房屋墙面修复",
      category: "non_main",
      declaredSubtype: "non_main_expense",
      area: "全部",
      partyA: ENGINEERING,
      partyB: "安徽特鸽建筑工程有限公司",
      mainFileName: "1-劳务外包合同-20241018￥162500.pdf",
      expectedInvoiceAmount: 162_500,
      expectedSettlementAmount: 162_500,
    },
    {
      id: "second-011",
      directory:
        "非主营项目合同/非主营支出/安徽特鸽建筑工程有限公司/20241126￥1700000￥1050000√",
      projectName:
        "苏家坨镇一镇一园集体产业用地前沙涧S7-2地块项目（1#集体产业用房等14项）弱电项目工程劳务分包",
      category: "non_main",
      declaredSubtype: "non_main_expense",
      area: "全部",
      partyA: ENGINEERING,
      partyB: "安徽特鸽建筑工程有限公司",
      mainFileName: "1-劳务分包合同-20241126￥1700000.pdf",
      expectedInvoiceAmount: 2_750_000,
      expectedSettlementAmount: 2_750_000,
    },
    {
      id: "second-012",
      directory:
        "非主营项目合同/非主营支出/安徽特鸽建筑工程有限公司/20241201￥206955√",
      projectName: "北京市朝阳区黑泉路103号房屋墙面修复",
      category: "non_main",
      declaredSubtype: "non_main_expense",
      area: "全部",
      partyA: ENGINEERING,
      partyB: "安徽特鸽建筑工程有限公司",
      mainFileName: "1-劳务分包合同-20241201￥206955.pdf",
      expectedInvoiceAmount: 206_955,
      expectedSettlementAmount: 206_955,
    },
    {
      id: "second-013",
      directory:
        "非主营项目合同/非主营支出/安徽特鸽建筑工程有限公司/20251210￥1828101√",
      projectName:
        "北京市海淀区国家电网办公区、各110千伏变电站、各220千伏变电站及其附属设施房屋墙面漆面修复、孔洞混凝土修复、钢结构面漆修复、部分结构拆除、辅材辅料采购运输及垃圾清运",
      category: "non_main",
      declaredSubtype: "non_main_expense",
      area: "全部",
      partyA: ENGINEERING,
      partyB: "安徽特鸽建筑工程有限公司",
      mainFileName: "1-劳务外包合同-20251210￥1828101.pdf",
      expectedInvoiceAmount: 1_828_101,
      expectedSettlementAmount: 1_828_101,
    },
    {
      id: "second-014",
      directory: "非主营项目合同/非主营支出/工程→北京国康顺通贸易有限公司",
      projectName: "配电箱及配电箱内配置的相关电子元器件硬件采购",
      category: "non_main",
      declaredSubtype: "non_main_expense",
      area: "全部",
      partyA: ENGINEERING,
      partyB: "北京国康顺通贸易有限公司",
      mainFileName: "1-辅材辅料采购合同-20241213￥63645.2.pdf",
      businessContractNo: "YL-20241017",
      expectedInvoiceAmount: 63_645.2,
      expectedSettlementAmount: 63_645.2,
    },
    {
      id: "second-015",
      directory: "非主营项目合同/非主营支出/工程→北京京达启辰科技有限公司",
      projectName: "苏家坨镇S7-2弱电智能化项目",
      category: "non_main",
      declaredSubtype: "non_main_expense",
      area: "全部",
      partyA: ENGINEERING,
      partyB: "北京京达启辰科技有限公司",
      mainFileName: "1-产品购销合同-20241011￥342858.89.pdf",
      businessContractNo: "JDQC-YLGC2024-10-08",
      expectedInvoiceAmount: 379_479.89,
      expectedSettlementAmount: 379_479.89,
    },
    {
      id: "second-016",
      directory: "非主营项目合同/非主营支出/工程→北京鹏飞环宇科技有限公司",
      projectName: "电源线采购",
      category: "non_main",
      declaredSubtype: "non_main_expense",
      area: "全部",
      partyA: ENGINEERING,
      partyB: "北京鹏飞环宇科技有限公司",
      mainFileName: "1-采购合同-20250622￥4960.pdf",
      roots: [
        {
          mainFileName: "1-采购合同-20250622￥4960.pdf",
          projectName: "电源线采购",
          businessContractNo: "20250622-1",
          financialAmounts: [4_960],
        },
        {
          mainFileName: "1-采购合同-20251027￥7637.pdf",
          projectName: "光纤跳线、模块、光纤收发器、电源线及网线采购",
          financialAmounts: [7_637],
        },
      ],
      expectedInvoiceAmount: 12_597,
      expectedSettlementAmount: 12_597,
    },
    {
      id: "second-017",
      directory: "非主营项目合同/非主营支出/工程→北京世纪华凯科技有限公司",
      projectName: "苏家坨项目监控杆及配电箱采购",
      category: "non_main",
      declaredSubtype: "non_main_expense",
      area: "全部",
      partyA: ENGINEERING,
      partyB: "北京世纪华凯科技有限公司",
      mainFileName: "1-购销合同-20250512￥21120.pdf",
      roots: [
        {
          mainFileName: "1-购销合同-20250512￥21120.pdf",
          projectName: "苏家坨项目监控杆及配电箱采购",
          financialAmounts: [21_120, 6_336, 14_784],
        },
        {
          mainFileName: "1-购销合同-20250519￥3900.pdf",
          projectName: "苏家坨项目机柜采购",
          financialAmounts: [3_900],
        },
      ],
      expectedInvoiceAmount: 25_020,
      expectedSettlementAmount: 25_020,
    },
    {
      id: "second-018",
      directory: "非主营项目合同/非主营支出/工程→北京中冀天泽科技有限公司",
      projectName: "护套线、屏蔽线采购",
      category: "non_main",
      declaredSubtype: "non_main_expense",
      area: "全部",
      partyA: ENGINEERING,
      partyB: "北京中冀天泽科技有限公司",
      mainFileName: "1-产品购销合同-20241106￥157527.78.pdf",
      roots: [
        {
          mainFileName: "1-产品购销合同-20241031￥157527.78.pdf",
          auxiliaryOnly: true,
        },
        {
          mainFileName: "1-产品购销合同-20241106￥157527.78.pdf",
          businessContractNo: "SHIP-ZJTZ-202410110003",
          projectName: "护套线、屏蔽线采购",
          ownsSupplements: true,
        },
      ],
      expectedInvoiceAmount: 236_092,
      expectedSettlementAmount: 236_092,
    },
    {
      id: "second-019",
      directory: "非主营项目合同/非主营支出/工程→张家口舆坤科技有限公司",
      projectName: "辅材辅料采购",
      category: "non_main",
      declaredSubtype: "non_main_expense",
      area: "全部",
      partyA: ENGINEERING,
      partyB: "张家口舆坤科技有限公司",
      mainFileName: "1-辅材料采购合同-20250417￥50756.pdf",
      businessContractNo: "YL-20250409",
      expectedInvoiceAmount: 50_756,
      expectedSettlementAmount: 50_756,
    },
    {
      id: "second-020",
      directory:
        "主营项目合同/宝湾全球高端贸易供应链示范基地项目施工图预审查-中建七局安装工程有限公司",
      projectName: "宝湾全球高端贸易供应链示范基地项目施工图预审查委托服务",
      category: "main_business",
      declaredSubtype: "engineering_consulting",
      area: "全部",
      partyA: "中建七局安装工程有限公司",
      partyB: ENGINEERING,
      mainFileName:
        "1-委托服务合同-宝湾全球高端贸易供应链示范基地项目施工图预审查-20230317￥867217.pdf",
      businessContractNo: "中建071103202300499001",
      expectedInvoiceAmount: 867_217,
      expectedSettlementAmount: 867_217,
    },
    {
      id: "second-021",
      directory: "主营项目合同/朝阳区/北京华源厚土科技有限司公司",
      projectName: "焦化厂110千伏输变电工程（电力管线）项目",
      category: "main_business",
      declaredSubtype: "engineering_consulting",
      area: "朝阳区",
      partyA: "北京华源厚土科技有限公司",
      partyB: ENGINEERING,
      mainFileName:
        "1-信息咨询合同-焦化厂110千伏输变电工程（电力管线）项目-20230601￥100000.pdf",
      expectedInvoiceAmount: 100_000,
      expectedSettlementAmount: 100_000,
    },
    {
      id: "second-022",
      directory: "主营项目合同/朝阳区/龙潭湖-弘善110kv线路工程建设项目",
      projectName: "龙潭湖-弘善110kv线路工程建设项目",
      category: "main_business",
      declaredSubtype: "engineering_consulting",
      area: "朝阳区",
      partyA: "北京路水方圆工程咨询有限公司",
      partyB: ENGINEERING,
      mainFileName:
        "1-信息咨询合同-龙潭湖-弘善110kv线路工程建设项目-20230825￥15840.pdf",
      expectedInvoiceAmount: 15_840,
      expectedSettlementAmount: 15_840,
      restoreContractId: "sdylIKVZJDN8jYQ342rOL",
    },
    {
      id: "second-023",
      directory:
        "主营项目合同/海淀区/创新园110千伏变电站房屋质量检测及安全鉴定/北京市建设工程质量第一检测所有限责任公司",
      projectName: "创新园110千伏变电站结构检测及鉴定项目",
      category: "main_business",
      declaredSubtype: "engineering_consulting",
      area: "海淀区",
      partyA: "北京市建设工程质量第一检测所有限责任公司",
      partyB: ENGINEERING,
      mainFileName:
        "1-技术服务合同-创新园110千伏变电站结构检测及鉴定项目-20230925￥139150.pdf",
      expectedInvoiceAmount: 139_150,
      expectedSettlementAmount: 139_150,
    },
    {
      id: "second-024",
      directory:
        "主营项目合同/海淀区/稻香湖110千伏变电站房屋质量检测及安全鉴定/北京市建设工程质量第一检测所有限责任公司",
      projectName: "稻香湖110千伏变电站结构检测及鉴定项目",
      category: "main_business",
      declaredSubtype: "engineering_consulting",
      area: "海淀区",
      partyA: "北京市建设工程质量第一检测所有限责任公司",
      partyB: ENGINEERING,
      mainFileName:
        "1-技术服务合同-稻香湖110千伏变电站结构检测及鉴定项目-20230921￥139150.pdf",
      expectedInvoiceAmount: 139_150,
      expectedSettlementAmount: 139_150,
    },
    {
      id: "second-025",
      directory:
        "主营项目合同/海淀区/东小营110千伏变电站等5项结构检测及鉴定项目",
      projectName: "东小营110千伏变电站等5项结构检测及鉴定项目",
      category: "main_business",
      declaredSubtype: "engineering_consulting",
      area: "海淀区",
      partyA: "北京市建设工程质量第一检测所有限责任公司",
      partyB: ENGINEERING,
      mainFileName:
        "1-技术服务合同-东小营110千伏变电站等5项结构检测及鉴定项目-20241129￥250000.pdf",
      expectedInvoiceAmount: 250_000,
      expectedSettlementAmount: 250_000,
    },
    {
      id: "second-026",
      directory: "主营项目合同/海淀区/后屯110千伏变电站房屋安全鉴定",
      projectName: "国网北京海淀供电公司后屯110千伏变电站房屋检测服务",
      category: "main_business",
      declaredSubtype: "engineering_consulting",
      area: "海淀区",
      partyA: "北京市建设工程质量第三检测所有限责任公司",
      partyB: ENGINEERING,
      mainFileName:
        "1-技术服务合同-后屯 110 千伏变电站房屋检测服务-20221225￥66000.pdf",
      expectedInvoiceAmount: 66_000,
      expectedSettlementAmount: 66_000,
    },
    {
      id: "second-027",
      directory:
        "主营项目合同/海淀区/后屯110千伏变电站消防现场检查/北京博霖翔皓消防科技有限公司",
      projectName: "后屯变电站工程项目",
      category: "main_business",
      declaredSubtype: "engineering_consulting",
      area: "海淀区",
      partyA: "北京博霖翔皓消防科技有限公司",
      partyB: ENGINEERING,
      mainFileName: "1-信息咨询合同-后屯变电站工程项目-20230101￥66110.pdf",
      expectedInvoiceAmount: 66_110,
      expectedSettlementAmount: 66_110,
    },
    {
      id: "second-028",
      directory:
        "主营项目合同/海淀区/万方安和项目/1#住宅等26项（中央党校西墙外和六郎庄缺口回迁安置房A-1地块项目）图纸资料整理事项√",
      projectName:
        "1#住宅等26项（中央党校西墙外和六郎庄缺口回迁安置房A-1地块项目）图纸资料整理事项",
      category: "main_business",
      declaredSubtype: "engineering_consulting",
      area: "海淀区",
      partyA: "北京万方安和投资有限责任公司",
      partyB: "北京万柳置业集团有限公司",
      partyC: ENGINEERING,
      mainFileName:
        "1-技术服务合同-1#住宅等26项（中央党校西墙外和六郎庄缺口回迁安置房A-1地块项目）图纸资料整理事项-20230325￥900000.pdf",
      expectedInvoiceAmount: 900_000,
      expectedSettlementAmount: 900_000,
    },
    {
      id: "second-029",
      directory:
        "主营项目合同/海淀区/万方安和项目/1#住宅等26项（中央党校西墙外和六郎庄缺口回迁安置房A-1地块项目）裕和嘉园住宅部分不动产权转移登记",
      projectName:
        "1#住宅等26项（中央党校西墙外和六郎庄缺口回迁安置房A-1地块项目）裕和嘉园住宅部分不动产权转移登记",
      category: "main_business",
      declaredSubtype: "engineering_consulting",
      area: "海淀区",
      partyA: "北京万方安和投资有限责任公司",
      partyB: ENGINEERING,
      mainFileName:
        "1-技术服务合同-1#住宅等26项（中央党校西墙外和六郎庄缺口回迁安置房A-1地块项目）裕和嘉园住宅部分不动产权转移登记-20231115.pdf",
      expectedInvoiceAmount: 845_000,
      expectedSettlementAmount: 845_000,
      target: {
        amount: 996_000,
        quantity: 996,
        unitPrice: 1_000,
        confirmedAmount: 906_000,
        confirmedQuantity: 906,
        quantityUnit: "套",
      },
    },
    {
      id: "second-030",
      directory:
        "主营项目合同/海淀区/万方安和项目/1#住宅等26项（中央党校西墙外和六郎庄缺口回迁安置房A-1地块项目）住宅部分不动产权初始登记等6项√",
      projectName:
        "1#住宅等26项（中央党校西墙外和六郎庄缺口回迁安置房A-1地块项目）住宅部分不动产权初始登记等6项",
      category: "main_business",
      declaredSubtype: "engineering_consulting",
      area: "海淀区",
      partyA: "北京万方安和投资有限责任公司",
      partyB: "北京万柳置业集团有限公司",
      partyC: ENGINEERING,
      mainFileName:
        "1-技术服务合同-1#住宅等26项（中央党校西墙外和六郎庄缺口回迁安置房A-1地块项目）住宅部分不动产权初始登记等6项-202311015￥970000.pdf",
      contractDateOverride: "2023-11-15",
      expectedInvoiceAmount: 955_608,
      expectedSettlementAmount: 955_608,
    },
    {
      id: "second-031",
      directory:
        "主营项目合同/门头沟区/清水110千伏输变电工程项目临时用地土地复垦方案编制/北京宏坤国地城市规划咨询有限公司",
      projectName: "门头沟清水110千伏变电站项目",
      category: "main_business",
      declaredSubtype: "engineering_consulting",
      area: "门头沟区",
      partyA: "北京宏坤国地城市规划咨询有限公司",
      partyB: ENGINEERING,
      mainFileName:
        "1-信息咨询合同-门头沟清水110千伏变电站项目-20230405￥87600.pdf",
      expectedInvoiceAmount: 87_600,
      expectedSettlementAmount: 87_600,
    },
    {
      id: "second-032",
      directory:
        "资产类合同/宝湾全球高端贸易供应链示范基地项目施工图预审查-璞拾著境（北京）空间工程设计有限公司",
      projectName: "宝湾全球高端贸易供应链示范基地项目",
      category: "asset",
      declaredSubtype: "procurement",
      area: "全部",
      partyA: ENGINEERING,
      partyB: "璞拾著境（北京）空间工程设计有限公司",
      mainFileName:
        "1-技术服务委托协议-宝湾全球高端贸易供应链示范基地项目-20230506￥180000.pdf",
      expectedInvoiceAmount: 180_000,
      expectedSettlementAmount: 180_000,
    },
    {
      id: "second-033",
      directory: "资产类合同/北京筑联天合建筑设计咨询有限公司",
      projectName: "国网朝阳项目设计技术咨询服务",
      category: "asset",
      declaredSubtype: "procurement",
      area: "全部",
      partyA: ENGINEERING,
      partyB: "北京筑联天合建筑设计咨询有限公司",
      mainFileName: "1-国网朝阳项目设计技术咨询服务合同-20221123￥380000.pdf",
      expectedInvoiceAmount: 148_836,
      expectedSettlementAmount: 148_836,
    },
    {
      id: "second-034",
      directory:
        "资产类合同/创新园110千伏变电站房屋质量检测及安全鉴定/北京博霖翔皓消防科技有限公司",
      projectName: "创新园110千伏变电站工程项目消电检测",
      category: "asset",
      declaredSubtype: "procurement",
      area: "全部",
      partyA: ENGINEERING,
      partyB: "北京博霖翔皓消防科技有限公司",
      mainFileName:
        "1-技术服务合同-创新园110千伏变电站工程项目消电检测-20230928￥8000.pdf",
      expectedInvoiceAmount: 8_000,
      expectedSettlementAmount: 8_000,
    },
    {
      id: "second-035",
      directory:
        "资产类合同/稻香湖110千伏变电站房屋质量检测及安全鉴定/北京博霖翔皓消防科技有限公司",
      projectName: "稻香湖110千伏变电站工程项目消电检测",
      category: "asset",
      declaredSubtype: "procurement",
      area: "全部",
      partyA: ENGINEERING,
      partyB: "北京博霖翔皓消防科技有限公司",
      mainFileName:
        "1-技术服务合同-稻香湖110千伏变电站工程项目消电检测-20230928￥8000.pdf",
      expectedInvoiceAmount: 8_000,
      expectedSettlementAmount: 8_000,
    },
    {
      id: "second-036",
      directory: "资产类合同/全弘（北京）企业服务有限公司",
      projectName: "劳务分包资质（建筑业企业资质证书）办理",
      category: "asset",
      declaredSubtype: "procurement",
      area: "全部",
      partyA: ENGINEERING,
      partyB: "全弘（北京）企业服务有限公司",
      mainFileName: "1-全弘服务合同-建筑业企业资质证书-20240228￥30000.pdf",
      businessContractNo: "BJ-QH-0000668",
      expectedInvoiceAmount: 30_000,
      expectedSettlementAmount: 30_000,
    },
    {
      id: "second-037",
      directory:
        "资产类合同/万方安和项目/1#住宅等26项（中央党校西墙外和六郎庄缺口回迁安置房A-1地块项目）图纸资料整理事项-璞拾著境√",
      projectName:
        "1#住宅等26项（中央党校西墙外和六郎庄缺口回迁安置房A-1地块项目）图纸资料整理事项",
      category: "asset",
      declaredSubtype: "procurement",
      area: "全部",
      partyA: ENGINEERING,
      partyB: "璞拾著境（北京）空间工程设计有限公司",
      mainFileName:
        "1-技术服务合同-1#住宅等26项（中央党校西墙外和六郎庄缺口回迁安置房A-1地块项目）图纸资料整理事项-璞拾著境20230601￥300000.pdf",
      expectedInvoiceAmount: 300_000,
      expectedSettlementAmount: 300_000,
    },
    {
      id: "second-038",
      directory: "资产类合同/万方安和项目/2023-北京市茂顺绘兰活动房有限公司",
      projectName: "办公宿舍型集装箱房及附件租赁",
      category: "asset",
      declaredSubtype: "procurement",
      area: "全部",
      partyA: "北京市茂顺绘兰活动房有限公司",
      partyB: ENGINEERING,
      mainFileName:
        "1-租赁合同-北京市茂顺绘兰活动房有限公司-20240119￥16483.2.pdf",
      expectedInvoiceAmount: 16_483.2,
      expectedSettlementAmount: 16_483.2,
    },
    {
      id: "second-039",
      directory: "资产类合同/万方安和项目/2024-北京星漾文化传播有限公司",
      projectName: "党校西项目兼职活动",
      category: "asset",
      declaredSubtype: "procurement",
      area: "全部",
      partyA: ENGINEERING,
      partyB: "北京星漾文化传播有限公司",
      mainFileName: "1-服务合同-党校西项目兼职-20240307￥100000.pdf",
      expectedInvoiceAmount: 100_000,
      expectedSettlementAmount: 50_000,
    },
  ] as const;

export function secondHistoricalDirection(
  family: SecondHistoricalFamilySpec,
): "income" | "cost" {
  return family.category === "asset" ||
    family.declaredSubtype === "non_main_expense"
    ? "cost"
    : "income";
}
