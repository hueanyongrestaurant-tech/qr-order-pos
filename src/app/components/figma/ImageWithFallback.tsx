import React, { useState } from 'react'

const ERROR_IMG_SRC =
  'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iODgiIGhlaWdodD0iODgiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyIgc3Ryb2tlPSIjMDAwIiBzdHJva2UtbGluZWpvaW49InJvdW5kIiBvcGFjaXR5PSIuMyIgZmlsbD0ibm9uZSIgc3Ryb2tlLXdpZHRoPSIzLjciPjxyZWN0IHg9IjE2IiB5PSIxNiIgd2lkdGg9IjU2IiBoZWlnaHQ9IjU2IiByeD0iNiIvPjxwYXRoIGQ9Im0xNiA1OCAxNi0xOCAzMiAzMiIvPjxjaXJjbGUgY3g9IjUzIiBjeT0iMzUiIHI9IjciLz48L3N2Zz4KCg=='

export function ImageWithFallback(props: React.ImgHTMLAttributes<HTMLImageElement>) {
  const [didError, setDidError] = useState(false)
  const [isLoaded, setIsLoaded] = useState(false)

  const handleError = () => {
    setDidError(true)
  }

  const handleLoad = () => {
    setIsLoaded(true)
  }

  const { src, alt, style, className, ...rest } = props

  return didError ? (
    <div
      className={`inline-block bg-gray-100 text-center align-middle ${className ?? ''}`}
      style={style}
    >
      <div className="flex items-center justify-center w-full h-full">
        <img src={ERROR_IMG_SRC} alt="Error loading image" {...rest} data-original-url={src} />
      </div>
    </div>
  ) : (
    // wrapper รับ className/style เดิมที่ผู้เรียกส่งมา (ขนาด/aspect ratio/มุมโค้งของ
    // caller ยังคุมผ่าน className นี้เหมือนเดิมทุกประการ) ส่วน skeleton + รูปจริงข้างใน
    // ใช้ absolute inset-0 ซ้อนเต็มพื้นที่ wrapper เพื่อโชว์ skeleton ระหว่างรอโหลด
    // แล้ว fade รูปจริงเข้ามาทับตอนโหลดเสร็จ โดยไม่ทำให้ขนาดกล่องรูปเปลี่ยนไปจากเดิม
    <div className={`relative overflow-hidden ${className ?? ''}`} style={style}>
      {!isLoaded && <div className="absolute inset-0 bg-muted animate-pulse" />}
      <img
        src={src}
        alt={alt}
        className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-300 ${isLoaded ? 'opacity-100' : 'opacity-0'}`}
        {...rest}
        onLoad={handleLoad}
        onError={handleError}
      />
    </div>
  )
}
