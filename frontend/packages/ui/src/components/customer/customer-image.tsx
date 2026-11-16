"use client"

import NextImage, { type ImageProps } from "next/image"
import { canOptimizeCustomerImage } from "@/lib/customer-image-policy"

export function CustomerImage(props: ImageProps) {
  return <NextImage {...props} unoptimized={props.unoptimized || !canOptimizeCustomerImage(props.src)} />
}
