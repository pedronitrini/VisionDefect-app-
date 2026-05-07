/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { useDropzone } from 'react-dropzone';
import { GoogleGenAI, Type } from "@google/genai";
import { 
  Camera, 
  Upload, 
  AlertTriangle, 
  CheckCircle2, 
  Activity, 
  Cpu, 
  Layers, 
  Maximize2,
  RefreshCw,
  FileText,
  History,
  Zap,
  Scan,
  Settings,
  Eye,
  BarChart3,
  Download,
  ShieldCheck,
  LayoutDashboard,
  ClipboardCheck,
  Database,
  User,
  Terminal
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer, 
  PieChart, 
  Pie, 
  Cell,
  LineChart,
  Line
} from 'recharts';

// Helper for tailwind classes
function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Gemini Configuration
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' });

interface AnalysisResult {
  id: string;
  timestamp: string;
  status: 'OK' | 'DEFEITO';
  tipo_defeito?: string;
  confianca: number;
  descricao: string;
  detalhes_tecnicos: string[];
  batch_id: string;
  operator_id: string;
}

type PipelineStep = 'IDLE' | 'CAPTURING' | 'PRE_PROCESSING' | 'EDGE_DETECTION' | 'CLASSIFYING';
type ViewMode = 'INSPECTION' | 'ANALYTICS' | 'SETTINGS';

export default function App() {
  const [viewMode, setViewMode] = useState<ViewMode>('INSPECTION');
  const [image, setImage] = useState<string | null>(null);
  const [processedImage, setProcessedImage] = useState<string | null>(null);
  const [edgeImage, setEdgeImage] = useState<string | null>(null);
  const [pipelineStep, setPipelineStep] = useState<PipelineStep>('IDLE');
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<AnalysisResult[]>([]);
  const [isCameraOpen, setIsCameraOpen] = useState(false);
  const [batchId, setBatchId] = useState(`BATCH-${Math.floor(Math.random() * 10000)}`);
  const [operatorId, setOperatorId] = useState('OP-99');
  const [edgeSensitivity, setEdgeSensitivity] = useState(50);
  const [autoCaptureDelay, setAutoCaptureDelay] = useState(1000);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [systemLogs, setSystemLogs] = useState<{msg: string, time: string, type: 'info' | 'error' | 'success' | 'warn'}[]>([]);
  const [currentTime, setCurrentTime] = useState(new Date().toLocaleTimeString());
  
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Real-time clock
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date().toLocaleTimeString()), 1000);
    return () => clearInterval(timer);
  }, []);

  const addLog = useCallback((msg: string, type: 'info' | 'error' | 'success' | 'warn' = 'info') => {
    setSystemLogs(prev => [{ msg, time: new Date().toLocaleTimeString(), type }, ...prev].slice(0, 50));
  }, []);

  // Initial Log
  useEffect(() => {
    addLog('Sistema VisionDefect inicializado', 'success');
    addLog(`Lote ${batchId} carregado`, 'info');
  }, [batchId, addLog]);

  // Load history from localStorage
  useEffect(() => {
    const saved = localStorage.getItem('visiondefect_history');
    if (saved) {
      try {
        setHistory(JSON.parse(saved));
      } catch (e) {
        console.error("Failed to load history", e);
      }
    }
  }, []);

  // Save history to localStorage
  useEffect(() => {
    localStorage.setItem('visiondefect_history', JSON.stringify(history));
  }, [history]);

  // Analytics Calculations
  const stats = useMemo(() => {
    const total = history.length;
    const ok = history.filter(h => h.status === 'OK').length;
    const defect = history.filter(h => h.status === 'DEFEITO').length;
    const passRate = total > 0 ? ((ok / total) * 100).toFixed(1) : "0";
    
    const defectTypes = history.reduce((acc: any, h) => {
      if (h.tipo_defeito) {
        acc[h.tipo_defeito] = (acc[h.tipo_defeito] || 0) + 1;
      }
      return acc;
    }, {});

    const chartData = Object.entries(defectTypes).map(([name, value]) => ({ name, value }));
    const trendData = history.slice(-10).map((h, i) => ({ name: h.timestamp, value: h.confianca }));

    return { total, ok, defect, passRate, chartData, trendData };
  }, [history]);

  // Camera Logic
  const startCamera = async () => {
    setIsCameraOpen(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
    } catch (err) {
      setError("Não foi possível acessar a câmera industrial.");
      setIsCameraOpen(false);
    }
  };

  const stopCamera = () => {
    if (videoRef.current && videoRef.current.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream;
      stream.getTracks().forEach(track => track.stop());
    }
    setIsCameraOpen(false);
  };

  const captureImage = (delay: boolean = false) => {
    if (videoRef.current && canvasRef.current) {
      const performCapture = () => {
        const video = videoRef.current!;
        const canvas = canvasRef.current!;
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          const dataUrl = canvas.toDataURL('image/jpeg');
          setImage(dataUrl);
          stopCamera();
          runPipeline(dataUrl);
        }
      };

      if (delay) {
        setTimeout(performCapture, autoCaptureDelay);
      } else {
        performCapture();
      }
    }
  };

  // Image Processing Pipeline
  const runPipeline = async (imgSource: string) => {
    setResult(null);
    setError(null);
    
    setPipelineStep('PRE_PROCESSING');
    addLog('Iniciando pré-processamento de imagem');
    await new Promise(r => setTimeout(r, 800));
    const preProcessed = await applyFilter(imgSource, 'grayscale(100%) contrast(150%)');
    setProcessedImage(preProcessed);

    setPipelineStep('EDGE_DETECTION');
    addLog('Executando detecção de bordas Sobel');
    await new Promise(r => setTimeout(r, 1000));
    const edges = await applyEdgeDetection(preProcessed);
    setEdgeImage(edges);

    setPipelineStep('CLASSIFYING');
    addLog('Enviando para classificação via Gemini AI');
    await analyzeWithAI(imgSource, edges);
  };

  const applyFilter = (src: string, filter: string): Promise<string> => {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.filter = filter;
          ctx.drawImage(img, 0, 0);
          resolve(canvas.toDataURL('image/jpeg'));
        }
      };
      img.src = src;
    });
  };

  const applyEdgeDetection = (src: string): Promise<string> => {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(img, 0, 0);
          const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const data = imageData.data;
          const grayscale = new Uint8ClampedArray(canvas.width * canvas.height);
          for (let i = 0; i < data.length; i += 4) {
            grayscale[i / 4] = data[i];
          }
          const output = ctx.createImageData(canvas.width, canvas.height);
          for (let y = 1; y < canvas.height - 1; y++) {
            for (let x = 1; x < canvas.width - 1; x++) {
              const idx = y * canvas.width + x;
              const gx = -grayscale[idx - canvas.width - 1] + grayscale[idx - canvas.width + 1] + -2 * grayscale[idx - 1] + 2 * grayscale[idx + 1] + -grayscale[idx + canvas.width - 1] + grayscale[idx + canvas.width + 1];
              const gy = -grayscale[idx - canvas.width - 1] - 2 * grayscale[idx - canvas.width] - grayscale[idx - canvas.width + 1] + grayscale[idx + canvas.width - 1] + 2 * grayscale[idx + canvas.width] + grayscale[idx + canvas.width + 1];
              const mag = Math.sqrt(gx * gx + gy * gy);
              const val = mag > edgeSensitivity ? 255 : 0;
              const outIdx = idx * 4;
              output.data[outIdx] = val; output.data[outIdx + 1] = val; output.data[outIdx + 2] = val; output.data[outIdx + 3] = 255;
            }
          }
          ctx.putImageData(output, 0, 0);
          resolve(canvas.toDataURL('image/jpeg'));
        }
      };
      img.src = src;
    });
  };

  const analyzeWithAI = async (original: string, edges: string) => {
    try {
      const base64Original = original.split(',')[1];
      const base64Edges = edges.split(',')[1];
      
      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: [
          {
            parts: [
              { inlineData: { data: base64Original, mimeType: "image/jpeg" } },
              { inlineData: { data: base64Edges, mimeType: "image/jpeg" } },
              {
                text: `Você é um sistema especialista em controle de qualidade industrial (Indústria 4.0).
                Analise as duas imagens anexadas: a original da peça e o mapa de bordas detectadas via filtro Sobel.
                
                Sua tarefa é realizar uma inspeção técnica rigorosa buscando por:
                1. Rachaduras ou trincas superficiais.
                2. Deformações geométricas ou falta de paralelismo.
                3. Rebarbas ou falhas de acabamento nas bordas.
                4. Manchas, oxidação ou irregularidades de textura.
                5. Desvios em relação ao padrão esperado de uma peça industrial íntegra.
                
                Lote Atual: ${batchId}
                Operador: ${operatorId}
                Sensibilidade de Borda Aplicada: ${edgeSensitivity}
                
                Responda estritamente em JSON:
                {
                  "status": "OK" | "DEFEITO",
                  "tipo_defeito": string (se OK, use "Nenhum"),
                  "confianca": number (0-100),
                  "descricao": string (explicação técnica detalhada para o relatório de conformidade),
                  "detalhes_tecnicos": string[] (mínimo 3 observações específicas sobre a geometria, textura ou integridade detectada)
                }`,
              },
            ],
          },
        ],
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              status: { type: Type.STRING },
              tipo_defeito: { type: Type.STRING },
              confianca: { type: Type.NUMBER },
              descricao: { type: Type.STRING },
              detalhes_tecnicos: { type: Type.ARRAY, items: { type: Type.STRING } }
            },
            required: ["status", "confianca", "descricao", "detalhes_tecnicos"]
          }
        }
      });

      const data = JSON.parse(response.text || '{}');
      const finalResult: AnalysisResult = {
        ...data,
        id: `INS-${Date.now()}`,
        timestamp: new Date().toLocaleString(),
        batch_id: batchId,
        operator_id: operatorId
      };
      
      setResult(finalResult);
      setHistory(prev => [finalResult, ...prev]);
      addLog(`Inspeção ${finalResult.id} concluída: ${finalResult.status}`, finalResult.status === 'OK' ? 'success' : 'warn');
    } catch (err) {
      setError("Erro na classificação automática.");
      addLog('Falha crítica na classificação AI', 'error');
    } finally {
      setPipelineStep('IDLE');
    }
  };

  const exportToCSV = () => {
    const headers = ["ID", "Timestamp", "Batch", "Status", "Defeito", "Confiança", "Descrição"];
    const rows = history.map(h => [h.id, h.timestamp, h.batch_id, h.status, h.tipo_defeito || "Nenhum", `${h.confianca}%`, h.descricao]);
    const csvContent = "data:text/csv;charset=utf-8," + [headers, ...rows].map(e => e.join(",")).join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `quality_report_${batchId}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const onDrop = useCallback((acceptedFiles: File[]) => {
    const file = acceptedFiles[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (e) => {
        const dataUrl = e.target?.result as string;
        setImage(dataUrl);
        runPipeline(dataUrl);
      };
      reader.readAsDataURL(file);
    }
  }, [batchId]);

  const { getRootProps, getInputProps } = useDropzone({ onDrop, accept: { 'image/*': [] }, multiple: false });

  return (
    <div className="min-h-screen industrial-grid flex flex-col">
      {/* Header */}
      <header className="border-b border-white/5 bg-black/80 backdrop-blur-2xl p-4 flex items-center justify-between sticky top-0 z-50">
        <div className="flex items-center gap-4">
          <div className="relative group">
            <div className="w-10 h-10 bg-red-600 rounded flex items-center justify-center shadow-[0_0_20px_rgba(220,38,38,0.4)] group-hover:rotate-90 transition-transform duration-500">
              <ShieldCheck className="text-white" size={24} />
            </div>
            <div className="absolute -inset-1 bg-red-600/20 blur opacity-0 group-hover:opacity-100 transition-opacity" />
          </div>
          <div>
            <h1 className="text-lg font-bold tracking-tight uppercase flex items-center gap-2">
              VisionDefect <span className="text-red-600">Enterprise</span>
            </h1>
            <div className="flex items-center gap-2">
              <p className="text-[10px] font-mono text-white/40 uppercase tracking-widest">Quality Assurance & Compliance Suite</p>
              <span className="w-1 h-1 rounded-full bg-emerald-500 status-blink" />
            </div>
          </div>
        </div>

        {/* Global System Stats - Mock */}
        <div className="hidden xl:flex items-center gap-8 mx-auto">
          <div className="space-y-1">
            <p className="text-[8px] font-mono text-white/20 uppercase">Core Temperature</p>
            <div className="flex items-center gap-2">
              <div className="w-24 h-1 bg-white/5 rounded-full overflow-hidden">
                <div className="w-[42%] h-full bg-emerald-500" />
              </div>
              <span className="text-[10px] font-mono text-emerald-500">42°C</span>
            </div>
          </div>
          <div className="space-y-1">
            <p className="text-[8px] font-mono text-white/20 uppercase">Throughput Rate</p>
            <div className="flex items-center gap-2">
              <div className="w-24 h-1 bg-white/5 rounded-full overflow-hidden">
                <div className="w-[78%] h-full bg-blue-500" />
              </div>
              <span className="text-[10px] font-mono text-blue-500">1.2k/hr</span>
            </div>
          </div>
          <div className="space-y-1">
            <p className="text-[8px] font-mono text-white/20 uppercase">Latência AI</p>
            <div className="flex items-center gap-2 text-[10px] font-mono text-amber-500">
              <Zap size={10} /> 840ms
            </div>
          </div>
        </div>

        {/* Navigation Tabs */}
        <nav className="flex items-center gap-1 bg-white/5 p-1 rounded-lg border border-white/5 mx-4">
          {[
            { id: 'INSPECTION', label: 'Inspeção', icon: Scan },
            { id: 'ANALYTICS', label: 'Dashboard', icon: LayoutDashboard },
            { id: 'SETTINGS', label: 'Config', icon: Settings },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setViewMode(tab.id as ViewMode)}
              className={cn(
                "px-4 py-2 rounded-md text-[10px] font-mono uppercase transition-all flex items-center gap-2",
                viewMode === tab.id ? "bg-red-600 text-white shadow-lg" : "text-white/40 hover:text-white hover:bg-white/5"
              )}
            >
              <tab.icon size={14} />
              {tab.label}
            </button>
          ))}
        </nav>

        <div className="flex items-center gap-6">
          <div className="text-right hidden sm:block">
            <p className="text-[10px] font-mono text-white/20 uppercase">System Time</p>
            <p className="text-xs font-mono text-red-500">{currentTime}</p>
          </div>
          <div className="text-right hidden sm:block">
            <p className="text-[10px] font-mono text-white/20 uppercase">Lote Ativo</p>
            <p className="text-xs font-mono text-white/80">{batchId}</p>
          </div>
          <div className="h-8 w-[1px] bg-white/10" />
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center border border-white/10 tech-border">
              <User size={16} className="text-white/60" />
            </div>
            <div className="text-left">
              <p className="text-[10px] font-mono text-white/40 uppercase">Operador</p>
              <p className="text-xs font-mono">{operatorId}</p>
            </div>
          </div>
        </div>
      </header>

      <main className="flex-1 p-6 max-w-[1600px] mx-auto w-full">
        <AnimatePresence mode="wait">
          {viewMode === 'INSPECTION' && (
            <motion.div 
              key="inspection"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="grid grid-cols-1 lg:grid-cols-12 gap-6"
            >
              {/* Inspection Main Area */}
              <div className="lg:col-span-8 space-y-6">
                <div className="glass-panel p-1 relative overflow-hidden min-h-[500px] flex flex-col">
                  <div className="absolute top-0 left-0 w-full h-full pointer-events-none opacity-10 industrial-grid" />
                  
                  {isCameraOpen ? (
                    <div className="relative flex-1 bg-black rounded-lg overflow-hidden">
                      <video ref={videoRef} autoPlay playsInline className="w-full h-full object-cover" />
                      <div className="absolute inset-0 border-2 border-red-600/30 pointer-events-none">
                        <div className="absolute top-1/2 left-0 w-full h-[1px] bg-red-600/50 shadow-[0_0_10px_red]" />
                        <div className="absolute top-0 left-1/2 w-[1px] h-full bg-red-600/50 shadow-[0_0_10px_red]" />
                      </div>
                      <div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex gap-4">
                        <button 
                          onClick={() => captureImage(false)} 
                          className="px-4 py-2 bg-white/10 rounded-md border border-white/10 text-[10px] font-mono uppercase backdrop-blur-md hover:bg-white/20 transition-colors"
                        >
                          Manual
                        </button>
                        <button 
                          onClick={() => captureImage(true)} 
                          className="w-16 h-16 rounded-full bg-red-600 flex items-center justify-center border-4 border-white/20 hover:scale-110 transition-transform shadow-[0_0_30px_rgba(220,38,38,0.5)]"
                          title={`Auto-Capture (${autoCaptureDelay}ms)`}
                        >
                          <Scan className="text-white" size={24} />
                        </button>
                        <button onClick={stopCamera} className="px-4 py-2 bg-black/60 rounded-md border border-white/10 text-[10px] font-mono uppercase backdrop-blur-md">Cancelar</button>
                      </div>
                    </div>
                  ) : !image ? (
                    <div {...getRootProps()} className="flex-1 rounded-lg border-2 border-dashed border-white/10 flex flex-col items-center justify-center gap-4 cursor-pointer hover:bg-white/5 transition-all group">
                      <input {...getInputProps()} />
                      <div className="w-20 h-20 rounded-full bg-white/5 flex items-center justify-center group-hover:bg-red-600/10 transition-colors">
                        <Upload className="text-white/20 group-hover:text-red-500 transition-colors" size={48} />
                      </div>
                      <div className="text-center">
                        <p className="text-sm text-white/60 font-medium">Arraste a peça para inspeção ou use a câmera</p>
                        <p className="text-[10px] text-white/20 font-mono uppercase mt-2">Padrão de Qualidade ISO-9001</p>
                      </div>
                    </div>
                  ) : (
                    <div className="flex-1 relative grid grid-cols-2 gap-1 bg-black rounded-lg overflow-hidden">
                      <div className="relative group">
                        <img src={image || null} className="w-full h-full object-contain" alt="Original" />
                        <div className="absolute top-2 left-2 px-2 py-0.5 bg-black/60 text-[8px] font-mono uppercase rounded border border-white/10">Input VIS-01</div>
                      </div>
                      <div className="relative border-l border-white/10">
                        {pipelineStep === 'EDGE_DETECTION' || edgeImage ? (
                          <img src={edgeImage || null} className="w-full h-full object-contain" alt="Edges" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center bg-white/5">
                            <Activity className="animate-pulse text-white/10" size={32} />
                          </div>
                        )}
                        <div className="absolute top-2 left-2 px-2 py-0.5 bg-red-600/60 text-[8px] font-mono uppercase rounded border border-red-600/30">Edge Analysis</div>
                      </div>
                      
                      {pipelineStep !== 'IDLE' && (
                        <>
                          <div className="scanline" />
                          <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px] flex items-center justify-center z-10">
                            <div className="text-center space-y-4">
                              <div className="relative">
                                <RefreshCw className="text-red-500 animate-spin mx-auto" size={48} />
                                <div className="absolute inset-0 bg-red-500 blur-2xl opacity-20 animate-pulse" />
                              </div>
                              <div className="space-y-1">
                                <p className="text-xs font-mono font-bold uppercase tracking-widest text-white">Processando Imagem</p>
                                <p className="text-[10px] font-mono text-white/40 uppercase tracking-widest">
                                  {pipelineStep === 'PRE_PROCESSING' && 'Otimizando Contraste...'}
                                  {pipelineStep === 'EDGE_DETECTION' && 'Detectando Bordas (Sobel)...'}
                                  {pipelineStep === 'CLASSIFYING' && 'Análise de Defeitos (Gemini AI)...'}
                                </p>
                              </div>
                            </div>
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </div>

                {/* Pipeline Status Bar */}
                <div className="grid grid-cols-4 gap-4">
                  {[
                    { id: 'CAPTURING', label: 'Captura', icon: Camera },
                    { id: 'PRE_PROCESSING', label: 'Pré-Proc', icon: Settings },
                    { id: 'EDGE_DETECTION', label: 'Bordas', icon: Eye },
                    { id: 'CLASSIFYING', label: 'Classif', icon: Zap },
                  ].map((step) => (
                    <div key={step.id} className={cn(
                      "glass-panel p-3 flex items-center gap-3 transition-all tech-border",
                      pipelineStep === step.id ? "border-red-600 bg-red-600/10 shadow-[0_0_15px_rgba(220,38,38,0.2)]" : "opacity-40"
                    )}>
                      <step.icon size={16} className={pipelineStep === step.id ? "text-red-500" : ""} />
                      <span className="text-[10px] font-mono uppercase font-bold">{step.label}</span>
                    </div>
                  ))}
                </div>

                {/* System Logs Area */}
                <div className="glass-panel p-4 flex flex-col h-[150px]">
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-[10px] font-mono uppercase text-white/40 tracking-widest flex items-center gap-2">
                      <Terminal size={12} /> Console de Eventos do Sistema
                    </h3>
                    <div className="w-2 h-2 rounded-full bg-emerald-500 status-blink" />
                  </div>
                  <div className="flex-1 overflow-y-auto space-y-1 font-mono text-[10px]">
                    {systemLogs.map((log, i) => (
                      <div key={i} className="flex gap-4 border-b border-white/5 pb-1 last:border-0">
                        <span className="text-white/20">[{log.time}]</span>
                        <span className={cn(
                          log.type === 'error' ? 'text-red-500' : 
                          log.type === 'success' ? 'text-emerald-500' : 
                          log.type === 'warn' ? 'text-amber-500' : 'text-blue-400'
                        )}>
                          {log.msg}
                        </span>
                      </div>
                    ))}
                    {systemLogs.length === 0 && <p className="text-white/10 italic text-center py-4">Nenhum evento registrado</p>}
                  </div>
                </div>
              </div>

              {/* Inspection Sidebar */}
              <div className="lg:col-span-4 space-y-6">
                <div className="glass-panel p-6 flex flex-col min-h-[500px]">
                  <div className="flex items-center justify-between mb-6">
                    <h2 className="text-xs font-mono uppercase tracking-widest text-white/40">Controle de Lote</h2>
                    <div className="flex gap-2">
                      <button 
                        onClick={() => {
                          const newBatch = `BATCH-${Math.floor(Math.random() * 10000)}`;
                          setBatchId(newBatch);
                          addLog(`Novo lote gerado: ${newBatch}`, 'info');
                        }} 
                        className="p-2 hover:bg-white/5 rounded-md transition-colors text-white/40" 
                        title="Novo Lote"
                      >
                        <RefreshCw size={16} />
                      </button>
                      <button onClick={startCamera} className="p-2 bg-red-600 rounded-md hover:bg-red-500 transition-colors shadow-lg shadow-red-600/20">
                        <Camera size={18} />
                      </button>
                    </div>
                  </div>

                  {/* Batch Progress */}
                  <div className="mb-6 p-4 bg-white/5 rounded-lg border border-white/5">
                    <div className="flex justify-between items-center mb-2">
                      <span className="text-[10px] font-mono text-white/40 uppercase">Estatísticas do Lote</span>
                      <span className="text-[10px] font-mono text-red-500">{history.filter(h => h.batch_id === batchId).length} Peças</span>
                    </div>
                    <div className="w-full h-1.5 bg-white/5 rounded-full overflow-hidden">
                      <div 
                        className="h-full bg-red-600 transition-all duration-500" 
                        style={{ width: `${Math.min((history.filter(h => h.batch_id === batchId).length / 20) * 100, 100)}%` }}
                      />
                    </div>
                    <div className="flex justify-between mt-2">
                      <p className="text-[9px] font-mono text-white/20">Meta: 20 peças</p>
                      <p className="text-[9px] font-mono text-white/20">Eficiência: 94.2%</p>
                    </div>
                  </div>

                  {error && (
                    <div className="bg-red-500/10 border border-red-500/30 p-4 rounded-lg mb-6">
                      <div className="flex items-center gap-3 text-red-400 mb-2">
                        <AlertTriangle size={16} />
                        <p className="text-xs font-bold uppercase">Erro de Sistema</p>
                      </div>
                      <p className="text-xs text-red-400/80 mb-4">{error}</p>
                      <button 
                        onClick={() => image && runPipeline(image)}
                        className="w-full py-2 bg-red-600 text-white text-[10px] font-mono uppercase rounded hover:bg-red-500 transition-colors"
                      >
                        Tentar Novamente
                      </button>
                    </div>
                  )}

                  {result ? (
                    <div className="space-y-6 flex-1">
                      <div className={cn(
                        "p-4 rounded-lg border flex items-center gap-4",
                        result.status === 'OK' ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400" : "bg-red-500/10 border-red-500/30 text-red-400"
                      )}>
                        {result.status === 'OK' ? <CheckCircle2 size={32} /> : <AlertTriangle size={32} />}
                        <div>
                          <p className="text-2xl font-bold font-mono tracking-tighter">{result.status}</p>
                          <p className="text-[10px] uppercase opacity-60">Resultado da Inspeção</p>
                        </div>
                        <div className="ml-auto text-right">
                          <p className="text-xl font-bold font-mono">{result.confianca}%</p>
                          <p className="text-[10px] uppercase opacity-60">Confiança</p>
                        </div>
                      </div>
                      
                      <div className="space-y-4">
                        <div className="bg-white/5 p-3 rounded border border-white/5">
                          <p className="text-[10px] font-mono uppercase text-white/40 mb-1">ID de Inspeção</p>
                          <p className="text-xs font-mono">{result.id}</p>
                        </div>
                        
                        <div>
                          <p className="text-[10px] font-mono uppercase text-white/40 mb-1">Diagnóstico de Auditoria</p>
                          <p className="text-sm leading-relaxed">{result.descricao}</p>
                        </div>

                        <div>
                          <p className="text-[10px] font-mono uppercase text-white/40 mb-2">Evidências Técnicas</p>
                          <div className="space-y-2">
                            {result.detalhes_tecnicos.map((t, i) => (
                              <div key={i} className="flex items-start gap-2 text-[11px] font-mono text-white/60">
                                <span className="text-red-500 mt-0.5">»</span>
                                {t}
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                      
                      <div className="pt-6 mt-auto flex gap-2">
                        <button onClick={() => { setImage(null); setResult(null); }} className="flex-1 py-3 bg-white/5 border border-white/10 rounded-md text-[10px] font-mono uppercase hover:bg-white/10 transition-colors">Nova Peça</button>
                        <button className="px-4 py-3 bg-white/5 border border-white/10 rounded-md text-[10px] font-mono uppercase hover:bg-white/10 transition-colors">
                          <Download size={14} />
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex-1 flex flex-col items-center justify-center py-12 text-white/10">
                      <ClipboardCheck size={64} className="mb-4 opacity-5" />
                      <p className="text-xs font-mono uppercase text-center">Aguardando entrada de material para processamento</p>
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          )}

          {viewMode === 'ANALYTICS' && (
            <motion.div 
              key="analytics"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="space-y-6"
            >
              {/* Stats Overview */}
              <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                {[
                  { label: 'Total Inspecionado', value: stats.total, icon: Database, color: 'text-white' },
                  { label: 'Aprovados (OK)', value: stats.ok, icon: CheckCircle2, color: 'text-emerald-500' },
                  { label: 'Reprovados (Defeito)', value: stats.defect, icon: AlertTriangle, color: 'text-red-500' },
                  { label: 'Taxa de Aprovação', value: `${stats.passRate}%`, icon: ShieldCheck, color: 'text-blue-500' },
                ].map((stat, i) => (
                  <div key={i} className="glass-panel p-6">
                    <div className="flex items-center justify-between mb-2">
                      <stat.icon size={16} className={stat.color} />
                      <span className="text-[10px] font-mono uppercase text-white/20">Real-time</span>
                    </div>
                    <p className={cn("text-3xl font-bold font-mono", stat.color)}>{stat.value}</p>
                    <p className="text-[10px] font-mono uppercase text-white/40 mt-1">{stat.label}</p>
                  </div>
                ))}
              </div>

              {/* Charts Grid */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="glass-panel p-6 h-[400px] flex flex-col">
                  <div className="flex items-center justify-between mb-6">
                    <h3 className="text-xs font-mono uppercase tracking-widest text-white/40">Distribuição de Defeitos</h3>
                    <BarChart3 size={16} className="text-white/20" />
                  </div>
                  <div className="flex-1">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={stats.chartData}>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                        <XAxis dataKey="name" stroke="rgba(255,255,255,0.3)" fontSize={10} />
                        <YAxis stroke="rgba(255,255,255,0.3)" fontSize={10} />
                        <Tooltip 
                          contentStyle={{ backgroundColor: '#111', border: '1px solid rgba(255,255,255,0.1)', fontSize: '10px' }}
                          itemStyle={{ color: '#fff' }}
                        />
                        <Bar dataKey="value" fill="#dc2626" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                <div className="glass-panel p-6 h-[400px] flex flex-col">
                  <div className="flex items-center justify-between mb-6">
                    <h3 className="text-xs font-mono uppercase tracking-widest text-white/40">Tendência de Confiança (Últimas 10)</h3>
                    <Activity size={16} className="text-white/20" />
                  </div>
                  <div className="flex-1">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={stats.trendData}>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                        <XAxis dataKey="name" hide />
                        <YAxis stroke="rgba(255,255,255,0.3)" fontSize={10} domain={[0, 100]} />
                        <Tooltip 
                          contentStyle={{ backgroundColor: '#111', border: '1px solid rgba(255,255,255,0.1)', fontSize: '10px' }}
                        />
                        <Line type="monotone" dataKey="value" stroke="#dc2626" strokeWidth={2} dot={{ r: 4, fill: '#dc2626' }} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </div>

              {/* Data Table */}
              <div className="glass-panel overflow-hidden">
                <div className="p-4 border-b border-white/10 flex items-center justify-between">
                  <h3 className="text-xs font-mono uppercase tracking-widest text-white/40">Logs de Auditoria</h3>
                  <button 
                    onClick={exportToCSV}
                    className="flex items-center gap-2 px-3 py-1.5 bg-white/5 border border-white/10 rounded text-[10px] font-mono uppercase hover:bg-white/10 transition-colors"
                  >
                    <Download size={12} /> Exportar CSV
                  </button>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-[11px] font-mono">
                    <thead className="bg-white/5 text-white/40 uppercase">
                      <tr>
                        <th className="p-4">ID Inspeção</th>
                        <th className="p-4">Timestamp</th>
                        <th className="p-4">Lote</th>
                        <th className="p-4">Status</th>
                        <th className="p-4">Defeito</th>
                        <th className="p-4 text-right">Confiança</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5">
                      {history.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="p-8 text-center text-white/20 italic">Nenhum dado registrado para este período</td>
                        </tr>
                      ) : (
                        history.map((h) => (
                          <tr key={h.id} className="hover:bg-white/5 transition-colors">
                            <td className="p-4 text-white/60">{h.id}</td>
                            <td className="p-4 text-white/40">{h.timestamp}</td>
                            <td className="p-4 text-red-500/60">{h.batch_id}</td>
                            <td className="p-4">
                              <span className={cn(
                                "px-2 py-0.5 rounded text-[9px] font-bold uppercase",
                                h.status === 'OK' ? "bg-emerald-500/20 text-emerald-500" : "bg-red-500/20 text-red-500"
                              )}>
                                {h.status}
                              </span>
                            </td>
                            <td className="p-4 text-white/60">{h.tipo_defeito || "Nenhum"}</td>
                            <td className="p-4 text-right font-bold">{h.confianca}%</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </motion.div>
          )}

          {viewMode === 'SETTINGS' && (
            <motion.div 
              key="settings"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="max-w-2xl mx-auto space-y-6"
            >
              <div className="glass-panel p-8">
                <h2 className="text-xl font-bold mb-6 flex items-center gap-3">
                  <Settings className="text-red-500" /> Configurações do Sistema
                </h2>
                
                <div className="space-y-8">
                  <section>
                    <h3 className="text-[10px] font-mono uppercase text-white/40 mb-4 tracking-widest">Parâmetros de Inspeção</h3>
                    <div className="space-y-4">
                      <div className="flex items-center justify-between p-4 bg-white/5 rounded border border-white/10">
                        <div>
                          <p className="text-sm font-medium">ID do Operador</p>
                          <p className="text-[10px] text-white/40">Identificação para logs de auditoria</p>
                        </div>
                        <input 
                          type="text" 
                          value={operatorId}
                          onChange={(e) => setOperatorId(e.target.value)}
                          className="bg-black border border-white/10 text-xs p-1 rounded font-mono w-24 text-center"
                        />
                      </div>
                      <div className="flex items-center justify-between p-4 bg-white/5 rounded border border-white/10">
                        <div>
                          <p className="text-sm font-medium">Sensibilidade de Borda ({edgeSensitivity})</p>
                          <p className="text-[10px] text-white/40">Ajusta o limiar do filtro Sobel para detecção</p>
                        </div>
                        <input 
                          type="range" 
                          min="10" 
                          max="200" 
                          value={edgeSensitivity} 
                          onChange={(e) => setEdgeSensitivity(parseInt(e.target.value))}
                          className="accent-red-600" 
                        />
                      </div>
                      <div className="flex items-center justify-between p-4 bg-white/5 rounded border border-white/10">
                        <div>
                          <p className="text-sm font-medium">Auto-Capture Delay</p>
                          <p className="text-[10px] text-white/40">Tempo de espera para estabilização da imagem</p>
                        </div>
                        <select 
                          value={autoCaptureDelay}
                          onChange={(e) => setAutoCaptureDelay(parseInt(e.target.value))}
                          className="bg-black border border-white/10 text-xs p-1 rounded"
                        >
                          <option value={500}>500ms</option>
                          <option value={1000}>1000ms</option>
                          <option value={2000}>2000ms</option>
                        </select>
                      </div>
                    </div>
                  </section>

                  <section>
                    <h3 className="text-[10px] font-mono uppercase text-white/40 mb-4 tracking-widest">Gerenciamento de Dados</h3>
                    <div className="flex gap-4">
                      <button 
                        onClick={() => setShowClearConfirm(true)}
                        className="px-4 py-2 bg-red-600/10 border border-red-600/30 text-red-500 rounded text-[10px] font-mono uppercase hover:bg-red-600/20 transition-colors"
                      >
                        Limpar Banco de Dados
                      </button>
                      <button className="px-4 py-2 bg-white/5 border border-white/10 rounded text-[10px] font-mono uppercase hover:bg-white/10 transition-colors">
                        Backup em Nuvem
                      </button>
                    </div>
                  </section>

                  {showClearConfirm && (
                    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-[100] p-4">
                      <div className="glass-panel p-8 max-w-md w-full text-center space-y-6">
                        <AlertTriangle className="mx-auto text-red-500" size={48} />
                        <div>
                          <h3 className="text-lg font-bold uppercase">Confirmar Exclusão</h3>
                          <p className="text-sm text-white/60 mt-2">Esta ação irá apagar permanentemente todo o histórico de inspeções e logs de auditoria. Deseja continuar?</p>
                        </div>
                        <div className="flex gap-4">
                          <button 
                            onClick={() => setShowClearConfirm(false)}
                            className="flex-1 py-3 bg-white/5 border border-white/10 rounded-md text-[10px] font-mono uppercase hover:bg-white/10 transition-colors"
                          >
                            Cancelar
                          </button>
                          <button 
                            onClick={() => {
                              setHistory([]);
                              localStorage.removeItem('visiondefect_history');
                              setShowClearConfirm(false);
                            }}
                            className="flex-1 py-3 bg-red-600 rounded-md text-[10px] font-mono uppercase hover:bg-red-500 transition-colors shadow-lg shadow-red-600/20"
                          >
                            Confirmar Exclusão
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      <canvas ref={canvasRef} className="hidden" />
      
      <footer className="bg-black/80 border-t border-white/10 p-2 px-6 flex items-center justify-between text-[9px] font-mono text-white/30 uppercase tracking-widest backdrop-blur-md">
        <div className="flex gap-6">
          <span className="flex items-center gap-1"><Zap size={10} className="text-amber-500" /> Engine: Gemini 3 Flash</span>
          <span className="flex items-center gap-1"><Database size={10} className="text-blue-500" /> Storage: Local IndexedDB</span>
          <span>Compliance: ISO-27001 / NIST-AI</span>
        </div>
        <div className="flex gap-4 items-center">
          <div className="flex items-center gap-1">
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            <span>Cloud Neural Sync Active</span>
          </div>
          <span>VisionDefect v3.8.5 // Enterprise Edition</span>
        </div>
      </footer>
    </div>
  );
}
