import type { Lang } from '../shared/i18n'

/** App text on the guide screens. The guide itself (steps, parts, tools) is translated by Gemini. */
const en = {
  start: 'Start',
  next: 'Next',
  done: 'Done',
  back: 'Back',
  writingSteps: 'Writing steps…',
  noSteps: 'No steps',
  overview: 'Overview',
  stepOf: 'Step {n} of {count}',
  takeApart: 'Take apart',
  putTogether: 'Put together',
  allSteps: 'All steps',
  whatAiSaw: 'What the AI saw',
  difficulty: 'Difficulty',
  time: 'Time',
  parts: 'Parts',
  tools: 'Tools',
  hardware: 'Hardware',
  fromDocs: 'From the documentation',
  safety: 'Safety',
  estimate: 'estimate',
  manual: 'Manual:',
  similarManual: 'Similar model’s manual:',
  easy: 'Easy',
  medium: 'Medium',
  hard: 'Hard',
  minutes: '~{n} min',
  buySpares: 'Buy spares',
  findReplacement: 'Find a replacement',
  searching: 'Searching…',
  noMatches: 'No matches.',
  loadFailed: 'Couldn’t load products.',
  fromShop: 'From Shop',
  close: 'Close',
  findingParts: 'Finding the parts…',
  checkingSteps: 'Checking the steps…',
  buildingModel: 'Building the 3D model…',
  partsOf: '{n} of {count} parts',
  partCount: '{n} parts',
  loadingModel: 'Loading the 3D model…',
  somethingOff: 'Something off?',
  checkPhoto: 'Check a photo',
  updated: 'Updated from feedback',
  translating: 'Translating…',
  language: 'Language',
}
export type StringKey = keyof typeof en

const es: typeof en = {
  start: 'Empezar', next: 'Siguiente', done: 'Listo', back: 'Atrás', writingSteps: 'Escribiendo pasos…', noSteps: 'Sin pasos',
  overview: 'Resumen', stepOf: 'Paso {n} de {count}', takeApart: 'Desmontar', putTogether: 'Montar', allSteps: 'Todos los pasos',
  whatAiSaw: 'Lo que vio la IA', difficulty: 'Dificultad', time: 'Tiempo', parts: 'Piezas', tools: 'Herramientas', hardware: 'Tornillería',
  fromDocs: 'De la documentación', safety: 'Seguridad', estimate: 'estimado', manual: 'Manual:', similarManual: 'Manual de un modelo similar:',
  easy: 'Fácil', medium: 'Media', hard: 'Difícil', minutes: '~{n} min', buySpares: 'Comprar repuestos', findReplacement: 'Buscar un recambio',
  searching: 'Buscando…', noMatches: 'Sin resultados.', loadFailed: 'No se pudieron cargar los productos.', fromShop: 'De Shop', close: 'Cerrar',
  findingParts: 'Buscando las piezas…', checkingSteps: 'Revisando los pasos…', buildingModel: 'Creando el modelo 3D…', partsOf: '{n} de {count} piezas',
  partCount: '{n} piezas', loadingModel: 'Cargando el modelo 3D…', somethingOff: '¿Algo no va bien?', checkPhoto: 'Revisar con una foto',
  updated: 'Actualizado por comentarios', translating: 'Traduciendo…', language: 'Idioma',
}
const fr: typeof en = {
  start: 'Commencer', next: 'Suivant', done: 'Terminé', back: 'Retour', writingSteps: 'Rédaction des étapes…', noSteps: 'Aucune étape',
  overview: 'Aperçu', stepOf: 'Étape {n} sur {count}', takeApart: 'Démonter', putTogether: 'Remonter', allSteps: 'Toutes les étapes',
  whatAiSaw: 'Ce que l’IA a vu', difficulty: 'Difficulté', time: 'Durée', parts: 'Pièces', tools: 'Outils', hardware: 'Visserie',
  fromDocs: 'D’après la documentation', safety: 'Sécurité', estimate: 'estimation', manual: 'Notice :', similarManual: 'Notice d’un modèle proche :',
  easy: 'Facile', medium: 'Moyen', hard: 'Difficile', minutes: '~{n} min', buySpares: 'Acheter des pièces', findReplacement: 'Trouver un remplacement',
  searching: 'Recherche…', noMatches: 'Aucun résultat.', loadFailed: 'Impossible de charger les produits.', fromShop: 'Via Shop', close: 'Fermer',
  findingParts: 'Recherche des pièces…', checkingSteps: 'Vérification des étapes…', buildingModel: 'Création du modèle 3D…', partsOf: '{n} pièces sur {count}',
  partCount: '{n} pièces', loadingModel: 'Chargement du modèle 3D…', somethingOff: 'Un souci ?', checkPhoto: 'Vérifier avec une photo',
  updated: 'Mis à jour selon les retours', translating: 'Traduction…', language: 'Langue',
}
const de: typeof en = {
  start: 'Los geht’s', next: 'Weiter', done: 'Fertig', back: 'Zurück', writingSteps: 'Schritte werden geschrieben…', noSteps: 'Keine Schritte',
  overview: 'Übersicht', stepOf: 'Schritt {n} von {count}', takeApart: 'Zerlegen', putTogether: 'Zusammenbauen', allSteps: 'Alle Schritte',
  whatAiSaw: 'Was die KI gesehen hat', difficulty: 'Schwierigkeit', time: 'Zeit', parts: 'Teile', tools: 'Werkzeug', hardware: 'Schrauben',
  fromDocs: 'Aus der Anleitung', safety: 'Sicherheit', estimate: 'geschätzt', manual: 'Anleitung:', similarManual: 'Anleitung eines ähnlichen Modells:',
  easy: 'Leicht', medium: 'Mittel', hard: 'Schwer', minutes: '~{n} Min.', buySpares: 'Ersatz kaufen', findReplacement: 'Ersatzteil finden',
  searching: 'Suche…', noMatches: 'Keine Treffer.', loadFailed: 'Produkte konnten nicht geladen werden.', fromShop: 'Über Shop', close: 'Schließen',
  findingParts: 'Teile werden erkannt…', checkingSteps: 'Schritte werden geprüft…', buildingModel: '3D-Modell wird erstellt…', partsOf: '{n} von {count} Teilen',
  partCount: '{n} Teile', loadingModel: '3D-Modell wird geladen…', somethingOff: 'Stimmt etwas nicht?', checkPhoto: 'Mit Foto prüfen',
  updated: 'Nach Rückmeldungen aktualisiert', translating: 'Wird übersetzt…', language: 'Sprache',
}
const pt: typeof en = {
  start: 'Começar', next: 'Próximo', done: 'Concluído', back: 'Voltar', writingSteps: 'Escrevendo os passos…', noSteps: 'Sem passos',
  overview: 'Visão geral', stepOf: 'Passo {n} de {count}', takeApart: 'Desmontar', putTogether: 'Montar', allSteps: 'Todos os passos',
  whatAiSaw: 'O que a IA viu', difficulty: 'Dificuldade', time: 'Tempo', parts: 'Peças', tools: 'Ferramentas', hardware: 'Parafusos',
  fromDocs: 'Da documentação', safety: 'Segurança', estimate: 'estimativa', manual: 'Manual:', similarManual: 'Manual de um modelo parecido:',
  easy: 'Fácil', medium: 'Média', hard: 'Difícil', minutes: '~{n} min', buySpares: 'Comprar reposição', findReplacement: 'Encontrar substituta',
  searching: 'Buscando…', noMatches: 'Nenhum resultado.', loadFailed: 'Não foi possível carregar os produtos.', fromShop: 'Do Shop', close: 'Fechar',
  findingParts: 'Encontrando as peças…', checkingSteps: 'Verificando os passos…', buildingModel: 'Criando o modelo 3D…', partsOf: '{n} de {count} peças',
  partCount: '{n} peças', loadingModel: 'Carregando o modelo 3D…', somethingOff: 'Algo errado?', checkPhoto: 'Verificar com uma foto',
  updated: 'Atualizado com feedback', translating: 'Traduzindo…', language: 'Idioma',
}
const hi: typeof en = {
  start: 'शुरू करें', next: 'आगे', done: 'हो गया', back: 'पीछे', writingSteps: 'स्टेप लिखे जा रहे हैं…', noSteps: 'कोई स्टेप नहीं',
  overview: 'सारांश', stepOf: 'स्टेप {n} / {count}', takeApart: 'खोलें', putTogether: 'जोड़ें', allSteps: 'सभी स्टेप',
  whatAiSaw: 'AI ने क्या देखा', difficulty: 'कठिनाई', time: 'समय', parts: 'पुर्ज़े', tools: 'औज़ार', hardware: 'पेंच',
  fromDocs: 'मैनुअल से', safety: 'सुरक्षा', estimate: 'अनुमान', manual: 'मैनुअल:', similarManual: 'मिलते-जुलते मॉडल का मैनुअल:',
  easy: 'आसान', medium: 'मध्यम', hard: 'कठिन', minutes: '~{n} मिनट', buySpares: 'अतिरिक्त खरीदें', findReplacement: 'बदलने के लिए खोजें',
  searching: 'खोज रहे हैं…', noMatches: 'कुछ नहीं मिला।', loadFailed: 'प्रोडक्ट लोड नहीं हो सके।', fromShop: 'Shop से', close: 'बंद करें',
  findingParts: 'पुर्ज़े पहचाने जा रहे हैं…', checkingSteps: 'स्टेप जाँचे जा रहे हैं…', buildingModel: '3D मॉडल बन रहा है…', partsOf: '{count} में से {n} पुर्ज़े',
  partCount: '{n} पुर्ज़े', loadingModel: '3D मॉडल लोड हो रहा है…', somethingOff: 'कुछ गड़बड़?', checkPhoto: 'फ़ोटो से जाँचें',
  updated: 'फ़ीडबैक से अपडेट किया गया', translating: 'अनुवाद हो रहा है…', language: 'भाषा',
}
const ja: typeof en = {
  start: '開始', next: '次へ', done: '完了', back: '戻る', writingSteps: '手順を作成中…', noSteps: '手順なし',
  overview: '概要', stepOf: '手順 {n} / {count}', takeApart: '分解', putTogether: '組み立て', allSteps: 'すべての手順',
  whatAiSaw: 'AIが見たもの', difficulty: '難易度', time: '時間', parts: '部品', tools: '工具', hardware: 'ネジ類',
  fromDocs: '説明書より', safety: '安全', estimate: '推定', manual: '説明書：', similarManual: '類似モデルの説明書：',
  easy: 'かんたん', medium: 'ふつう', hard: 'むずかしい', minutes: '約{n}分', buySpares: '予備を購入', findReplacement: '交換部品を探す',
  searching: '検索中…', noMatches: '見つかりませんでした。', loadFailed: '商品を読み込めませんでした。', fromShop: 'Shopより', close: '閉じる',
  findingParts: '部品を検出中…', checkingSteps: '手順を確認中…', buildingModel: '3Dモデルを作成中…', partsOf: '{count}個中{n}個の部品',
  partCount: '部品 {n} 個', loadingModel: '3Dモデルを読み込み中…', somethingOff: 'うまくいかない？', checkPhoto: '写真で確認',
  updated: 'フィードバックで更新', translating: '翻訳中…', language: '言語',
}
const zh: typeof en = {
  start: '开始', next: '下一步', done: '完成', back: '返回', writingSteps: '正在编写步骤…', noSteps: '没有步骤',
  overview: '概览', stepOf: '第 {n} 步，共 {count} 步', takeApart: '拆卸', putTogether: '组装', allSteps: '全部步骤',
  whatAiSaw: 'AI 看到了什么', difficulty: '难度', time: '时间', parts: '零件', tools: '工具', hardware: '紧固件',
  fromDocs: '来自说明书', safety: '安全', estimate: '估计', manual: '说明书：', similarManual: '相似型号的说明书：',
  easy: '简单', medium: '中等', hard: '困难', minutes: '约 {n} 分钟', buySpares: '购买备件', findReplacement: '寻找替换件',
  searching: '搜索中…', noMatches: '没有结果。', loadFailed: '无法加载商品。', fromShop: '来自 Shop', close: '关闭',
  findingParts: '正在识别零件…', checkingSteps: '正在检查步骤…', buildingModel: '正在生成 3D 模型…', partsOf: '{n}/{count} 个零件',
  partCount: '{n} 个零件', loadingModel: '正在加载 3D 模型…', somethingOff: '有问题？', checkPhoto: '拍照检查',
  updated: '已根据反馈更新', translating: '正在翻译…', language: '语言',
}

const STRINGS: Record<Lang, typeof en> = { en, es, fr, de, pt, hi, ja, zh }

export function translate(lang: Lang, key: StringKey, vars?: Record<string, string | number>) {
  let s = STRINGS[lang][key] ?? en[key]
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replace(`{${k}}`, String(v))
  return s
}
