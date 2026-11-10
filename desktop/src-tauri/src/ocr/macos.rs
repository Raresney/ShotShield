//! Vision's text recognition (VNRecognizeTextRequest), built into macOS.

use std::io::Cursor;

use image::codecs::png::{CompressionType, FilterType, PngEncoder};
use image::{ExtendedColorType, ImageEncoder};
use objc2::rc::{autoreleasepool, Retained};
use objc2::runtime::AnyObject;
use objc2::{msg_send, sel, AnyThread};
use objc2_foundation::{NSArray, NSData, NSDictionary, NSError, NSObjectProtocol, NSRange, NSString};
use objc2_vision::{
    VNImageOption, VNImageRequestHandler, VNRecognizeTextRequest, VNRecognizedText, VNRectangleObservation,
    VNRequest, VNRequestTextRecognitionLevel,
};

use super::{to_pixels, utf16_words, Line};

/// The languages asked for, where this macOS version reads them: Romanian for
/// the IDs, English for everything else.
const WANTED: [&str; 2] = ["ro-RO", "en-US"];

pub fn recognize(rgba: Vec<u8>, width: i32, height: i32) -> Result<Vec<Line>, String> {
    // Vision takes encoded image data; a quick PNG keeps the pixels exact.
    let mut png = Cursor::new(Vec::new());
    PngEncoder::new_with_quality(&mut png, CompressionType::Fast, FilterType::NoFilter)
        .write_image(&rgba, width as u32, height as u32, ExtendedColorType::Rgba8)
        .map_err(|e| e.to_string())?;
    let png = png.into_inner();

    autoreleasepool(|_| {
        let data = NSData::with_bytes(&png);
        let options = NSDictionary::<VNImageOption, AnyObject>::new();
        let handler = VNImageRequestHandler::initWithData_options(VNImageRequestHandler::alloc(), &data, &options);

        let request = VNRecognizeTextRequest::new();
        request.setRecognitionLevel(VNRequestTextRecognitionLevel::Accurate);
        // Language correction "fixes" ID numbers and codes into words.
        request.setUsesLanguageCorrection(false);
        if let Some(languages) = supported_languages(&request) {
            request.setRecognitionLanguages(&languages);
        }

        let base: &VNRequest = &request;
        handler.performRequests_error(&NSArray::from_slice(&[base])).map_err(describe)?;

        let mut lines = Vec::new();
        for observation in request.results().iter().flat_map(|r| r.iter()) {
            let Some(candidate) = observation.topCandidates(1).iter().next() else { continue };
            let text = candidate.string().to_string();
            // SAFETY: boundingBox is a plain property read on a live observation.
            let line_box = unsafe { observation.boundingBox() };
            let words = utf16_words(&text)
                .into_iter()
                .map(|(word, start, len)| {
                    let rect = word_box(&candidate, start, len).unwrap_or((
                        line_box.origin.x,
                        line_box.origin.y,
                        line_box.size.width,
                        line_box.size.height,
                    ));
                    to_pixels(word, rect, width, height)
                })
                .collect();
            lines.push(Line { words });
        }
        Ok(lines)
    })
}

/// The wanted languages this system's Vision can read, or None to leave its
/// default (English) when it can't say.
fn supported_languages(request: &VNRecognizeTextRequest) -> Option<Retained<NSArray<NSString>>> {
    // supportedRecognitionLanguages arrived in macOS 12; the app runs on 11.
    if !request.respondsToSelector(sel!(supportedRecognitionLanguagesAndReturnError:)) {
        return None;
    }
    // SAFETY: the selector exists (checked above) and takes no arguments besides the error out-parameter.
    let supported = unsafe { request.supportedRecognitionLanguagesAndReturnError() }.ok()?;
    let supported: Vec<String> = supported.iter().map(|s| s.to_string()).collect();
    let picked: Vec<Retained<NSString>> = WANTED
        .iter()
        .filter(|lang| supported.iter().any(|s| s == *lang))
        .map(|lang| NSString::from_str(lang))
        .collect();
    (!picked.is_empty()).then(|| NSArray::from_retained_slice(&picked))
}

/// Where one word of a recognized line sits, normalized with the origin at
/// the bottom-left. None when Vision can't place it.
fn word_box(text: &VNRecognizedText, start: usize, len: usize) -> Option<(f64, f64, f64, f64)> {
    let range = NSRange { location: start, length: len };
    // SAFETY: boundingBoxForRange:error: takes an NSRange inside the candidate's
    // string (utf16_words counts in the same UTF-16 units) and returns a
    // retained rectangle observation or fills the error.
    let observation: Result<Retained<VNRectangleObservation>, Retained<NSError>> =
        unsafe { msg_send![text, boundingBoxForRange: range, error: _] };
    let observation = observation.ok()?;
    // SAFETY: a plain property read on a live observation.
    let b = unsafe { observation.boundingBox() };
    Some((b.origin.x, b.origin.y, b.size.width, b.size.height))
}

fn describe(e: Retained<NSError>) -> String {
    e.localizedDescription().to_string()
}
