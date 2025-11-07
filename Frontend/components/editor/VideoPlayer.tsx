import React, { useEffect, useRef, useState, useCallback } from 'react';
import { LoadingSpinner, ForwardIcon } from '../ui/Icons';
import { SubtitleStyle, BoundingBox, VideoSegment } from '../../types';

// --- WebGL Shaders ---

const VS_SOURCE = `
  attribute vec4 a_position;
  attribute vec2 a_texCoord;
  varying vec2 v_texCoord;
  void main() {
    gl_Position = a_position;
    v_texCoord = a_texCoord; // Do not flip Y, video frames are oriented correctly.
  }
`;

const FS_SOURCE = `
  precision mediump float;
  uniform sampler2D u_texture;
  varying vec2 v_texCoord;

  // Uniforms for future color grading capabilities
  uniform float u_exposure;    // Example: -1.0 to 1.0, default 0.0
  uniform float u_saturation;  // Example: 0.0 to 2.0, default 1.0

  void main() {
    vec4 color = texture2D(u_texture, v_texCoord);
    
    // Apply exposure
    color.rgb = color.rgb * pow(2.0, u_exposure);

    // Apply saturation
    float luma = dot(color.rgb, vec3(0.299, 0.587, 0.114));
    color.rgb = mix(vec3(luma), color.rgb, u_saturation);

    gl_FragColor = color;
  }
`;

// --- WebGL Helper Functions ---

const createShader = (gl: WebGLRenderingContext, type: number, source: string): WebGLShader | null => {
    const shader = gl.createShader(type);
    if (!shader) return null;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        console.error('An error occurred compiling the shaders: ' + gl.getShaderInfoLog(shader));
        gl.deleteShader(shader);
        return null;
    }
    return shader;
};

const createProgram = (gl: WebGLRenderingContext, vsSource: string, fsSource: string): WebGLProgram | null => {
    const vertexShader = createShader(gl, gl.VERTEX_SHADER, vsSource);
    const fragmentShader = createShader(gl, gl.FRAGMENT_SHADER, fsSource);
    if (!vertexShader || !fragmentShader) return null;

    const program = gl.createProgram();
    if (!program) return null;
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        console.error('Unable to initialize the shader program: ' + gl.getProgramInfoLog(program));
        return null;
    }
    return program;
};

interface SubtitleBbox {
    top: number;
    bottom: number;
    left: number;
    right: number;
}


/**
 * Draws subtitle text onto a canvas with advanced styling (outline).
 * Includes word wrapping.
 */
const drawSubtitles = (
    canvas: HTMLCanvasElement, 
    text: string, 
    style: SubtitleStyle, 
    onBboxCalculated: (bbox: SubtitleBbox | null) => void
) => {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const { width, height } = canvas;
    ctx.clearRect(0, 0, width, height);

    if (!text.trim() || !style) {
        onBboxCalculated(null);
        return;
    }

    // Scale font and outline based on video height (1080p reference)
    const scaleFactor = height / 1080;
    const fontSize = Math.max(10, (style.fontSize || 48) * scaleFactor);
    const outlineWidth = (style.outlineWidth || 2.5) * scaleFactor;

    ctx.font = `${fontSize}px "${style.fontFamily || 'Arial'}"`;
    ctx.lineJoin = 'round';
    ctx.lineWidth = outlineWidth * 2; // lineWidth is centered, so double for full stroke
    ctx.strokeStyle = style.outlineColor || '#000000';
    ctx.fillStyle = style.primaryColor || '#FFFFFF';
    ctx.textAlign = style.horizontalAlign || 'center';
    ctx.textBaseline = 'bottom';
    
    let y = height * (1 - (style.verticalMargin || 8) / 100);

    const initialLines = text.split('\n');
    const linesToRender: string[] = [];

    // Word wrapping logic
    const maxWidth = width * 0.96; // Use 96% of canvas width for text
    initialLines.forEach(line => {
        if (ctx.measureText(line).width <= maxWidth) {
            linesToRender.push(line);
        } else {
            const words = line.split(' ');
            let currentLine = '';
            for (const word of words) {
                const testLine = currentLine ? `${currentLine} ${word}` : word;
                if (ctx.measureText(testLine).width > maxWidth && currentLine) {
                    linesToRender.push(currentLine);
                    currentLine = word;
                } else {
                    currentLine = testLine;
                }
            }
            if (currentLine) {
                linesToRender.push(currentLine);
            }
        }
    });

    if (linesToRender.length === 0) {
        onBboxCalculated(null);
        return;
    }

    const lineHeight = fontSize * 1.4;
    const totalTextHeight = linesToRender.length * lineHeight - (lineHeight - fontSize);
    const textBottom = y;
    const textTop = y - totalTextHeight;

    let maxTextWidth = 0;
    linesToRender.forEach(line => {
        maxTextWidth = Math.max(maxTextWidth, ctx.measureText(line).width);
    });

    const horizontalAlign = style.horizontalAlign || 'center';
    let textLeft, textRight;
    // FIX: Declare and define the 'x' coordinate for drawing subtitle text, resolving a 'Cannot find name' error. The x-coordinate is now correctly calculated based on the horizontal alignment (left, center, or right) before being used in `ctx.strokeText` and `ctx.fillText`.
    let x: number;
    if (horizontalAlign === 'center') {
        x = width / 2;
        textLeft = (width / 2) - (maxTextWidth / 2);
        textRight = (width / 2) + (maxTextWidth / 2);
    } else if (horizontalAlign === 'left') {
        x = width * 0.02;
        textLeft = x;
        textRight = textLeft + maxTextWidth;
    } else { // right
        x = width * 0.98;
        textRight = x;
        textLeft = textRight - maxTextWidth;
    }

    onBboxCalculated({
        top: textTop - 10,
        bottom: textBottom + 10,
        left: textLeft - 10,
        right: textRight + 10,
    });


    // Draw lines from bottom to top
    for (let i = linesToRender.length - 1; i >= 0; i--) {
        const lineToRender = linesToRender[i];
        if (outlineWidth > 0) {
            ctx.strokeText(lineToRender, x, y);
        }
        ctx.fillText(lineToRender, x, y);
        y -= lineHeight; // Line height
    }
};

const dbToGain = (db: number) => {
    if (db <= -60) return 0; // Mute threshold
    return 10 ** (db / 20);
};


interface VideoPlayerProps {
    videoRef: React.RefObject<HTMLVideoElement>;
    videoUrl: string | null;
    isLoading: boolean;
    segments: VideoSegment[];
    masterVolumeDb: number;
    isMuted: boolean;
    activeSubtitlesText: string;
    subtitleStyle?: SubtitleStyle;
    hardsubCoverBox?: BoundingBox;
    isOverlayVisible: boolean;
    onLoadedMetadata: () => void;
    onPlay: () => void;
    onPause: () => void;
    onTogglePlayPause: () => void;
    onSubtitleStyleChange: (style: SubtitleStyle) => void;
}

const VideoPlayer: React.FC<VideoPlayerProps> = ({
    videoRef, videoUrl, isLoading, segments, masterVolumeDb, isMuted, activeSubtitlesText, subtitleStyle, hardsubCoverBox,
    isOverlayVisible,
    onLoadedMetadata, onPlay, onPause, onTogglePlayPause,
    onSubtitleStyleChange
}) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const webglCanvasRef = useRef<HTMLCanvasElement>(null);
    const subtitleCanvasRef = useRef<HTMLCanvasElement>(null);

    const [playerSize, setPlayerSize] = useState({ width: 0, height: 0 });
    const [subtitleBbox, setSubtitleBbox] = useState<SubtitleBbox | null>(null);
    const [isHoveringSubtitles, setIsHoveringSubtitles] = useState(false);
    
    const dragInfo = useRef<{
        isDragging: boolean;
        startY: number;
        startMargin: number;
    }>({ isDragging: false, startY: 0, startMargin: 0 }).current;

    const glState = useRef<{
        gl: WebGLRenderingContext | null,
        program: WebGLProgram | null,
        uniforms: { [key: string]: WebGLUniformLocation | null },
        texture: WebGLTexture | null,
        rVfcHandle: number | null
    }>({ gl: null, program: null, uniforms: {}, texture: null, rVfcHandle: null }).current;

    const audioApi = useRef<{
        audioContext: AudioContext | null;
        sourceNode: MediaElementAudioSourceNode | null;
        segmentGainNode: GainNode | null;
        masterGainNode: GainNode | null;
        isInitialized: boolean;
    }>({ audioContext: null, sourceNode: null, segmentGainNode: null, masterGainNode: null, isInitialized: false }).current;


    // --- Sizing Logic ---
    const updatePlayerSize = useCallback(() => {
        if (videoRef.current && containerRef.current) {
            const videoEl = videoRef.current;
            const containerEl = containerRef.current;
            
            const containerW = containerEl.clientWidth;
            const containerH = containerEl.clientHeight;
            const videoW = videoEl.videoWidth;
            const videoH = videoEl.videoHeight;

            if (containerW === 0 || containerH === 0 || videoW === 0 || videoH === 0) {
                return;
            }

            const containerRatio = containerW / containerH;
            const videoRatio = videoW / videoH;
            let width, height;

            if (containerRatio > videoRatio) {
                height = containerH;
                width = height * videoRatio;
            } else {
                width = containerW;
                height = width / videoRatio;
            }
            setPlayerSize({ width, height });
        }
    }, [videoRef]);

    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;
        const resizeObserver = new ResizeObserver(updatePlayerSize);
        resizeObserver.observe(container);
        return () => resizeObserver.disconnect();
    }, [updatePlayerSize]);

    // --- WebGL Initialization ---
    useEffect(() => {
        const canvas = webglCanvasRef.current;
        if (!canvas) return;
        const gl = canvas.getContext('webgl', { alpha: false });
        if (!gl) { console.error("WebGL not supported"); return; }
        glState.gl = gl;

        const program = createProgram(gl, VS_SOURCE, FS_SOURCE);
        if (!program) return;
        glState.program = program;

        const positionAttribLocation = gl.getAttribLocation(program, "a_position");
        const texCoordAttribLocation = gl.getAttribLocation(program, "a_texCoord");
        glState.uniforms.u_texture = gl.getUniformLocation(program, "u_texture");
        glState.uniforms.u_exposure = gl.getUniformLocation(program, "u_exposure");
        glState.uniforms.u_saturation = gl.getUniformLocation(program, "u_saturation");

        const positionBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
        const positions = [-1, 1, -1, -1, 1, 1, 1, -1];
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(positions), gl.STATIC_DRAW);

        const texCoordBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, texCoordBuffer);
        const texCoords = [0, 0, 0, 1, 1, 0, 1, 1];
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(texCoords), gl.STATIC_DRAW);

        gl.enableVertexAttribArray(positionAttribLocation);
        gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
        gl.vertexAttribPointer(positionAttribLocation, 2, gl.FLOAT, false, 0, 0);

        gl.enableVertexAttribArray(texCoordAttribLocation);
        gl.bindBuffer(gl.ARRAY_BUFFER, texCoordBuffer);
        gl.vertexAttribPointer(texCoordAttribLocation, 2, gl.FLOAT, false, 0, 0);

        const texture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        glState.texture = texture;
    }, [glState]);
    
    // --- Audio API Initialization & Logic ---
    const initAudio = useCallback(() => {
        if (audioApi.isInitialized || !videoRef.current) return;

        const context = new (window.AudioContext || (window as any).webkitAudioContext)();
        audioApi.audioContext = context;
        
        if (context.state === 'suspended') {
            context.resume().catch(e => console.error("Audio context resume failed:", e));
        }

        audioApi.sourceNode = context.createMediaElementSource(videoRef.current);
        audioApi.segmentGainNode = context.createGain();
        audioApi.masterGainNode = context.createGain();

        audioApi.sourceNode
            .connect(audioApi.segmentGainNode)
            .connect(audioApi.masterGainNode)
            .connect(context.destination);
        
        audioApi.isInitialized = true;
    }, [videoRef, audioApi]);

    useEffect(() => {
        if (audioApi.masterGainNode && audioApi.audioContext) {
            const targetGain = isMuted ? 0 : dbToGain(masterVolumeDb);
            audioApi.masterGainNode.gain.setValueAtTime(targetGain, audioApi.audioContext.currentTime);
        }
    }, [masterVolumeDb, isMuted, audioApi.masterGainNode, audioApi.audioContext]);
    
    useEffect(() => {
        const video = videoRef.current;
        if (!video || !audioApi.isInitialized) return;

        let animationFrameId: number;
        const updateLoop = () => {
            const sourceTime = video.currentTime;
            const activeSegment = segments.find(seg => sourceTime >= seg.sourceStartTime && sourceTime < seg.sourceEndTime);
            const targetDb = activeSegment?.volumeDb ?? 0;
            const targetGain = dbToGain(targetDb);

            if (audioApi.segmentGainNode && audioApi.segmentGainNode.gain.value !== targetGain) {
                audioApi.segmentGainNode.gain.setValueAtTime(targetGain, audioApi.audioContext!.currentTime);
            }
            animationFrameId = requestAnimationFrame(updateLoop);
        };
        animationFrameId = requestAnimationFrame(updateLoop);
        return () => cancelAnimationFrame(animationFrameId);
    }, [videoRef, segments, audioApi.isInitialized, audioApi.segmentGainNode]);


    // --- Rendering Logic ---

    const drawCurrentFrame = useCallback(() => {
        const video = videoRef.current;
        const { gl, program, texture, uniforms } = glState;
        const canvas = webglCanvasRef.current;

        if (!video || !gl || !program || !texture || !canvas || video.readyState < video.HAVE_CURRENT_DATA) {
            return;
        }
        
        gl.viewport(0, 0, canvas.width, canvas.height);
        gl.useProgram(program);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.uniform1i(uniforms.u_texture, 0);
        gl.uniform1f(uniforms.u_exposure, 0.0);
        gl.uniform1f(uniforms.u_saturation, 1.0);

        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, video);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }, [glState, videoRef]);

    const renderLoop = useCallback<VideoFrameRequestCallback>((now, metadata) => {
        const video = videoRef.current;
        if (!video || video.paused || video.ended) {
            glState.rVfcHandle = null;
            return;
        }
        drawCurrentFrame();
        glState.rVfcHandle = video.requestVideoFrameCallback(renderLoop);
    }, [glState, videoRef, drawCurrentFrame]);

    useEffect(() => {
        const video = videoRef.current;
        if (!video) return;
        const onSeeked = () => {
            setTimeout(drawCurrentFrame, 50);
        };
        video.addEventListener('seeked', onSeeked);
        return () => video.removeEventListener('seeked', onSeeked);
    }, [drawCurrentFrame, videoRef]);

    const handlePlay = () => {
        initAudio(); // Initialize audio context on play
        const video = videoRef.current;
        if (video && !glState.rVfcHandle) {
            glState.rVfcHandle = video.requestVideoFrameCallback(renderLoop);
        }
        onPlay();
    };

    const handlePause = () => {
        onPause();
    };

    // --- Subtitle Rendering & Interaction ---
    useEffect(() => {
        const canvas = subtitleCanvasRef.current;
        if (!canvas || !subtitleStyle || playerSize.width === 0) return;
        drawSubtitles(canvas, activeSubtitlesText, subtitleStyle, setSubtitleBbox);
    }, [activeSubtitlesText, subtitleStyle, playerSize]);

    const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
        if (dragInfo.isDragging) {
            const container = containerRef.current;
            if (!container || !subtitleStyle) return;

            const deltaY = e.clientY - dragInfo.startY;
            const playerHeight = container.clientHeight;
            
            const deltaMargin = -(deltaY / playerHeight) * 100;
            let newMargin = dragInfo.startMargin + deltaMargin;
            newMargin = Math.max(0, Math.min(90, newMargin));
            
            onSubtitleStyleChange({ ...subtitleStyle, verticalMargin: newMargin });
            return;
        }

        if (subtitleBbox) {
            const rect = (e.target as HTMLElement).getBoundingClientRect();
            const y = e.clientY - rect.top;
            const x = e.clientX - rect.left;
            
            setIsHoveringSubtitles(
                y >= subtitleBbox.top && y <= subtitleBbox.bottom &&
                x >= subtitleBbox.left && x <= subtitleBbox.right
            );
        } else {
            setIsHoveringSubtitles(false);
        }
    };
    
    const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
        if (isHoveringSubtitles && subtitleStyle) {
            e.preventDefault();
            e.stopPropagation();
            dragInfo.isDragging = true;
            dragInfo.startY = e.clientY;
            dragInfo.startMargin = subtitleStyle.verticalMargin || 8;
        } else {
            onTogglePlayPause();
        }
    };
    
    const handleMouseUp = () => {
        dragInfo.isDragging = false;
    };
    
    const handleMouseLeave = () => {
        dragInfo.isDragging = false;
        setIsHoveringSubtitles(false);
    };    

    const overlayStyle: React.CSSProperties = {
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
    };

    return (
        <div className="w-full h-full p-4 flex flex-col">
            <div ref={containerRef} className="bg-black flex-grow flex items-center justify-center relative group">
                {isLoading && <LoadingSpinner className="w-10 h-10" />}
                
                <video 
                    ref={videoRef}
                    src={videoUrl ?? undefined}
                    onLoadedMetadata={() => {
                        onLoadedMetadata();
                        updatePlayerSize();
                        setTimeout(drawCurrentFrame, 100);
                    }}
                    onPlay={handlePlay}
                    onPause={handlePause}
                    playsInline
                    style={{ display: 'none' }}
                />

                <div 
                    style={{ width: playerSize.width, height: playerSize.height, position: 'relative' }}
                >
                    <canvas 
                        ref={webglCanvasRef} 
                        width={playerSize.width} 
                        height={playerSize.height}
                        className="block"
                    />
                    
                    {isOverlayVisible && hardsubCoverBox && hardsubCoverBox.enabled && (
                        <div
                            style={{
                                position: 'absolute',
                                left: `${hardsubCoverBox.x}%`,
                                top: `${hardsubCoverBox.y}%`,
                                width: `${hardsubCoverBox.width}%`,
                                height: `${hardsubCoverBox.height}%`,
                                backdropFilter: 'blur(10px)',
                                pointerEvents: 'none'
                            }}
                        />
                    )}

                    {isOverlayVisible && subtitleStyle?.videoFrameUrl && (
                        <img 
                            src={subtitleStyle.videoFrameUrl} 
                            alt="Video Frame" 
                            style={{ ...overlayStyle, objectFit: 'fill' }}
                        />
                    )}

                    <canvas 
                        ref={subtitleCanvasRef} 
                        width={playerSize.width}
                        height={playerSize.height}
                        style={overlayStyle} 
                    />

                    <div
                        style={{
                            ...overlayStyle,
                            pointerEvents: 'auto',
                            cursor: dragInfo.isDragging ? 'ns-resize' : isHoveringSubtitles ? 'ns-resize' : 'pointer',
                        }}
                        onMouseDown={handleMouseDown}
                        onMouseMove={handleMouseMove}
                        onMouseUp={handleMouseUp}
                        onMouseLeave={handleMouseLeave}
                    />
                </div>
            </div>
        </div>
    );
};

export default VideoPlayer;