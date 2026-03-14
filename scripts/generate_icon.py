#!/usr/bin/env python3
"""
Generate CC+ app icon with geometric C's and + design.

Creates a rounded rectangle icon with two vertically stacked C arcs
(drawn as geometric shapes, not text) and a bold + symbol to the right.
Uses Pillow's drawing primitives for full control over sizing and positioning.
Outputs PNGs at all required sizes and prepares an .iconset for macOS.
"""

import os
import sys
from pathlib import Path
from PIL import Image, ImageDraw

# Color scheme: refined developer tool aesthetic
BG_COLOR = "#1a1614"      # Deep warm charcoal
C_COLOR = "#f5f0e8"       # Warm off-white for C's
PLUS_COLOR = "#e8a84c"    # Warm amber/gold for +
BORDER_COLOR = "#2a2624"  # Subtle lighter border

# Icon sizes for macOS .icns
ICON_SIZES = [16, 32, 64, 128, 256, 512, 1024]

# Icon shape: rounded rectangle with ~22% corner radius
CORNER_RADIUS_RATIO = 0.22

# Stroke width as percentage of icon size
STROKE_WIDTH_RATIO = 0.14


def hex_to_rgb(hex_color):
    """Convert hex color to RGB tuple."""
    hex_color = hex_color.lstrip('#')
    return tuple(int(hex_color[i:i+2], 16) for i in (0, 2, 4))


def create_rounded_rectangle(size, radius, fill_color, border_color=None, border_width=1):
    """Create a rounded rectangle image with optional border."""
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    # Draw filled rounded rectangle
    draw.rounded_rectangle(
        [(0, 0), (size - 1, size - 1)],
        radius=radius,
        fill=hex_to_rgb(fill_color)
    )

    # Draw border if specified
    if border_color:
        draw.rounded_rectangle(
            [(0, 0), (size - 1, size - 1)],
            radius=radius,
            outline=hex_to_rgb(border_color),
            width=border_width
        )

    return img


def draw_c_arc(draw, center_x, center_y, radius, stroke_width, color):
    """
    Draw a C shape as a thick arc (270 degrees, opening to the right).

    Strategy: Draw a filled circle, then cut out the center and right wedge.
    """
    # Create a temporary layer for this C
    img = draw.im if hasattr(draw, 'im') else draw._image
    temp = Image.new('RGBA', img.size, (0, 0, 0, 0))
    temp_draw = ImageDraw.Draw(temp)

    # Draw outer filled circle
    outer_bbox = [
        center_x - radius,
        center_y - radius,
        center_x + radius,
        center_y + radius
    ]
    temp_draw.ellipse(outer_bbox, fill=hex_to_rgb(color))

    # Cut out inner circle to create thickness
    inner_radius = radius - stroke_width
    inner_bbox = [
        center_x - inner_radius,
        center_y - inner_radius,
        center_x + inner_radius,
        center_y + inner_radius
    ]
    temp_draw.ellipse(inner_bbox, fill=(0, 0, 0, 0))

    # Cut out the right wedge to create the C opening
    # Draw a triangle from center outward to the right
    wedge_extension = radius + stroke_width  # Extend beyond circle
    temp_draw.polygon([
        (center_x, center_y - stroke_width * 0.7),  # Top of wedge
        (center_x + wedge_extension, center_y - stroke_width * 0.7),
        (center_x + wedge_extension, center_y + stroke_width * 0.7),
        (center_x, center_y + stroke_width * 0.7)  # Bottom of wedge
    ], fill=(0, 0, 0, 0))

    # Composite the C onto the main image
    # Get the actual image object
    base_img = draw.im if hasattr(draw, 'im') else draw._image
    base_img.paste(temp, (0, 0), temp)


def draw_plus_sign(draw, center_x, center_y, size, stroke_width, color):
    """
    Draw a + sign using two thick rectangles (horizontal and vertical).

    Args:
        center_x, center_y: Center point of the +
        size: Length of each arm from center
        stroke_width: Thickness of each arm
        color: Color of the + sign
    """
    half_stroke = stroke_width / 2

    # Horizontal bar
    draw.rectangle([
        center_x - size, center_y - half_stroke,
        center_x + size, center_y + half_stroke
    ], fill=hex_to_rgb(color))

    # Vertical bar
    draw.rectangle([
        center_x - half_stroke, center_y - size,
        center_x + half_stroke, center_y + size
    ], fill=hex_to_rgb(color))


def generate_icon(size):
    """Generate a single icon at the specified size."""
    corner_radius = int(size * CORNER_RADIUS_RATIO)

    # Create rounded rectangle background
    img = create_rounded_rectangle(
        size,
        corner_radius,
        BG_COLOR,
        border_color=BORDER_COLOR,
        border_width=max(1, size // 512)  # Scale border width
    )

    draw = ImageDraw.Draw(img)

    # Calculate stroke width and sizes
    stroke_width = size * STROKE_WIDTH_RATIO

    # C arc parameters
    # Each C should take ~30% of icon height
    c_radius = size * 0.15  # Radius of each C

    # Gap between the two C's
    c_gap = size * 0.08

    # Total height of both C's plus gap
    total_c_height = (c_radius * 2) * 2 + c_gap

    # Center the composition vertically
    composition_center_y = size / 2

    # Top C position (upper C centered at composition_center_y - c_radius - c_gap/2)
    top_c_y = composition_center_y - c_radius - c_gap / 2

    # Bottom C position (lower C centered at composition_center_y + c_radius + c_gap/2)
    bottom_c_y = composition_center_y + c_radius + c_gap / 2

    # C's are positioned left of center
    c_x = size * 0.38

    # Draw both C arcs
    draw_c_arc(draw, c_x, top_c_y, c_radius, stroke_width, C_COLOR)
    draw_c_arc(draw, c_x, bottom_c_y, c_radius, stroke_width, C_COLOR)

    # Plus sign parameters
    # Position to the right of the C's, vertically centered
    plus_x = size * 0.68
    plus_y = composition_center_y
    plus_size = size * 0.12  # Arm length from center

    # Draw the + sign
    draw_plus_sign(draw, plus_x, plus_y, plus_size, stroke_width, PLUS_COLOR)

    return img


def main():
    """Generate all icon sizes and create .iconset directory."""
    # Setup paths
    project_root = Path(__file__).parent.parent
    iconset_dir = project_root / "ccplus.iconset"
    iconset_dir.mkdir(exist_ok=True)

    print(f"Generating CC+ app icons with geometric design...")
    print(f"Output directory: {iconset_dir}")
    print()

    # Generate all sizes
    for size in ICON_SIZES:
        # Standard resolution
        img = generate_icon(size)
        filename = f"icon_{size}x{size}.png"
        filepath = iconset_dir / filename
        img.save(filepath, "PNG")
        print(f"✓ Generated {filename}")

        # @2x resolution (for Retina displays)
        if size <= 512:  # macOS .icns convention
            retina_size = size * 2
            img_retina = generate_icon(retina_size)
            filename_retina = f"icon_{size}x{size}@2x.png"
            filepath_retina = iconset_dir / filename_retina
            img_retina.save(filepath_retina, "PNG")
            print(f"✓ Generated {filename_retina}")

    print()
    print(f"Icon generation complete!")
    print(f"Next step: Run 'iconutil -c icns {iconset_dir}'")


if __name__ == "__main__":
    main()
